const AuditLog = require("../models/AuditLog");

const SAFE_FIELDS = {
    FIR: ["firNo", "status", "crimeType", "policeStation", "registeredBy"],
    Case: ["caseNo", "status", "priority", "assignedOfficerIds", "criminalIds", "title"],
    Criminal: ["criminalId", "status", "fullName"],
    Evidence: ["evidenceId", "status", "verificationStatus", "currentCustodian", "caseId", "collectedBy", "type", "fileName", "fileHash", "fileSize", "mimeType", "uploadedAt", "integrityResult", "downloadOutcome"],
    Report: ["title", "status", "caseId", "preparedBy"],
    Officer: ["officerId", "rank", "status", "name"],
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

const log = async ({ actor, action, entityType, entityId, before, after, method, path, session, auditId }) => {
    if (!action || !entityType) throw new Error("Audit action and entity type are required");
    const beforeSnapshot = safeSnapshot(entityType, before);
    const afterSnapshot = safeSnapshot(entityType, after);
    const entry = {
        ...(auditId ? { _id: auditId } : {}),
        actor,
        action,
        entityType,
        entityId: entityId || undefined,
        occurredAt: new Date(),
        changes: {
            ...(beforeSnapshot ? { before: beforeSnapshot } : {}),
            ...(afterSnapshot ? { after: afterSnapshot } : {}),
        },
        metadata: { method, path },
    };
    if (session) {
        const [record] = await AuditLog.create([entry], { session });
        return record;
    }
    try {
        return await AuditLog.create(entry);
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

module.exports = { log, safeSnapshot };
