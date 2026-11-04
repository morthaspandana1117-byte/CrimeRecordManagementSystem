const crypto = require("crypto");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const AuditSequence = require("../models/AuditSequence");

const GENESIS_HASH = "0".repeat(64);

const SAFE_FIELDS = {
    FIR: ["firNo", "status", "crimeType", "policeStation", "registeredBy"],
    Case: ["caseNo", "status", "priority", "assignedOfficerIds", "criminalIds", "title"],
    Criminal: ["criminalId", "status", "fullName"],
    Evidence: ["evidenceId", "status", "verificationStatus", "currentCustodian", "pendingTransferId", "pendingToCustodian", "caseId", "collectedBy", "type", "fileName", "fileHash", "fileSize", "mimeType", "uploadedAt", "integrityResult", "downloadOutcome"],
    Report: ["title", "status", "caseId", "preparedBy"],
    Officer: ["officerId", "rank", "status", "name", "approvalStatus", "isActive"],
};

const safeValue = (value) => {
    if (Array.isArray(value)) return value.map(safeValue);
    if (value && typeof value === "object") {
        if (value._id) return String(value._id);
        if (value.toHexString) return value.toHexString();
        return "[REDACTED]";
    }
    return value;
};

const safeSnapshot = (entityType, value) => {
    if (!value || typeof value !== "object") return undefined;
    const fields = SAFE_FIELDS[entityType] || [];
    const snapshot = {};
    for (const key of fields) {
        if (value[key] !== undefined) snapshot[key] = safeValue(value[key]);
    }
    return Object.keys(snapshot).length ? snapshot : undefined;
};

const canonicalize = (value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof mongoose.Types.ObjectId) return value.toString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = canonicalize(value[key]);
                return result;
            }, {});
    }
    return value;
};

const integrityPayload = ({ sequence, actor, action, entityType, entityId, occurredAt, changes, metadata }) =>
    canonicalize({
        sequence,
        actor: actor || null,
        action,
        entityType,
        entityId: entityId || null,
        occurredAt,
        changes: changes && Object.keys(changes).length ? changes : null,
        metadata: metadata || null,
    });

const calculateHash = (previousHash, sequence, entry) =>
    crypto.createHash("sha256")
        .update(`${previousHash}:${JSON.stringify(integrityPayload({ ...entry, sequence }))}`)
        .digest("hex");

const isTransactionCapableTopology = async () => {
    if (mongoose.connection.readyState !== 1) return false;
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === "isdbgrid");
};

const allocateIntegrity = async (entry, session) => {
    const sequenceRecord = await AuditSequence.findOneAndUpdate(
        { _id: "audit-log" },
        { $inc: { nextSequence: 1 } },
        { returnDocument: "after", upsert: true, session },
    ).lean();
    const sequence = sequenceRecord.nextSequence;
    const previous = sequence === 1
        ? null
        : await AuditLog.findOne({ "integrity.sequence": sequence - 1 })
            .select("integrity.hash")
            .session(session)
            .lean();
    const previousHash = previous?.integrity?.hash || GENESIS_HASH;
    return {
        sequence,
        previousHash,
        hash: calculateHash(previousHash, sequence, entry),
    };
};

const createEntry = async (entry, session) => {
    const integrity = await allocateIntegrity(entry, session);
    const record = await AuditLog.create([{ ...entry, integrity }], { session });
    return record[0];
};

const log = async ({ actor, action, entityType, entityId, before, after, method, path, session, auditId }) => {
    if (!action || !entityType) throw new Error("Audit action and entity type are required");
    const beforeSnapshot = safeSnapshot(entityType, before);
    const afterSnapshot = safeSnapshot(entityType, after);
    const entry = {
        ...(auditId ? { _id: auditId } : {}),
        actor: actor || null,
        action,
        entityType,
        entityId: entityId || null,
        occurredAt: new Date(),
        changes: {
            ...(beforeSnapshot ? { before: beforeSnapshot } : {}),
            ...(afterSnapshot ? { after: afterSnapshot } : {}),
        },
        metadata: { method: method || null, path: path || null },
    };
    if (session) {
        return createEntry(entry, session);
    }
    try {
        if (!(await module.exports.isTransactionCapableTopology())) {
            return await AuditLog.create(entry);
        }
        const newSession = await mongoose.startSession();
        try {
            let record;
            await newSession.withTransaction(async () => {
                record = await createEntry(entry, newSession);
            });
            return record;
        } finally {
            await newSession.endSession();
        }
    } catch (error) {
        if (auditId) {
            try {
                const existing = await AuditLog.findById(auditId)
                    .select("entityId entityType action")
                    .lean();
                if (
                    existing &&
                    String(existing.entityId) === String(entityId) &&
                    existing.entityType === entityType &&
                    existing.action === action
                ) return existing;
            } catch {
                // Preserve the creation error if verification itself is unavailable.
            }
        }
        throw error;
    }
};

const integrityFailure = (issue, checkedRecords, legacyRecords, malformedRecords) => ({
    valid: false,
    scope: "all-audit-records",
    issue,
    checkedRecords,
    legacyRecords,
    unprotectedRecords: legacyRecords,
    malformedRecords,
});

const verifyIntegrity = async () => {
    const [allRecords, sequenceRecord] = await Promise.all([
        AuditLog.find({})
            .select("actor action entityType entityId occurredAt changes metadata integrity")
            .lean(),
        AuditSequence.findById("audit-log").select("nextSequence").lean(),
    ]);

    const protectedRecords = [];
    let legacyRecords = 0;
    let malformedRecords = 0;
    for (const record of allRecords) {
        const integrity = record.integrity;
        const hasIntegrityField = Object.prototype.hasOwnProperty.call(record, "integrity");
        if (!hasIntegrityField) {
            legacyRecords += 1;
            continue;
        }
        if (
            !integrity ||
            !Number.isInteger(integrity.sequence) ||
            integrity.sequence < 1 ||
            typeof integrity.previousHash !== "string" ||
            typeof integrity.hash !== "string"
        ) {
            malformedRecords += 1;
            continue;
        }
        protectedRecords.push(record);
    }

    if (malformedRecords) {
        return integrityFailure("MALFORMED_INTEGRITY_RECORD", allRecords.length, legacyRecords, malformedRecords);
    }

    protectedRecords.sort((left, right) => left.integrity.sequence - right.integrity.sequence);
    let previousHash = GENESIS_HASH;
    for (let index = 0; index < protectedRecords.length; index += 1) {
        const record = protectedRecords[index];
        const expectedSequence = index + 1;
        if (record.integrity.sequence !== expectedSequence) {
            return integrityFailure(
                "MISSING_OR_REORDERED_RECORD",
                allRecords.length,
                legacyRecords,
                malformedRecords,
            );
        }
        if (record.integrity.previousHash !== previousHash) {
            return integrityFailure("INVALID_PREVIOUS_HASH", allRecords.length, legacyRecords, malformedRecords);
        }
        const expectedHash = calculateHash(record.integrity.previousHash, record.integrity.sequence, record);
        if (record.integrity.hash !== expectedHash) {
            return integrityFailure("MODIFIED_RECORD", allRecords.length, legacyRecords, malformedRecords);
        }
        previousHash = record.integrity.hash;
    }

    const lastSequence = protectedRecords.length;
    if (protectedRecords.length > 0 && !sequenceRecord) {
        return integrityFailure("MISSING_SEQUENCE_COUNTER", allRecords.length, legacyRecords, malformedRecords);
    }
    if (sequenceRecord && sequenceRecord.nextSequence !== lastSequence) {
        const issue = sequenceRecord.nextSequence > lastSequence
            ? "MISSING_OR_REORDERED_RECORD"
            : "SEQUENCE_COUNTER_MISMATCH";
        return integrityFailure(issue, allRecords.length, legacyRecords, malformedRecords);
    }

    return {
        valid: true,
        scope: "all-audit-records",
        checkedRecords: allRecords.length,
        protectedRecords: protectedRecords.length,
        legacyRecords,
        unprotectedRecords: legacyRecords,
        malformedRecords,
    };
};

module.exports = { log, safeSnapshot, verifyIntegrity, isTransactionCapableTopology };
