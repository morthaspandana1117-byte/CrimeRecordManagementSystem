const AuditLog = require("../models/AuditLog");

const SAFE_FIELDS = {
    FIR: ["firNo", "status", "crimeType", "policeStation", "registeredBy"],
    Case: ["caseNo", "status", "priority", "assignedOfficerIds", "criminalIds", "title"],
    Criminal: ["criminalId", "status", "fullName"],
    Evidence: ["evidenceId", "status", "verificationStatus", "currentCustodian", "caseId", "collectedBy", "type"],
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

const log = async ({ actor, action, entityType, entityId, before, after, method, path }) => {
    if (!action || !entityType) throw new Error("Audit action and entity type are required");
    const beforeSnapshot = safeSnapshot(entityType, before);
    const afterSnapshot = safeSnapshot(entityType, after);
    return AuditLog.create({
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
    });
};

module.exports = { log, safeSnapshot };
