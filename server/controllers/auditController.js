const AuditLog = require("../models/AuditLog");
const { isValidObjectId, invalid, handleError } = require("./controllerUtils");

const listAuditLogs = async (req, res) => {
    try {
        const filter = {};
        if (req.query.entityType) filter.entityType = String(req.query.entityType);
        if (req.query.entityId) {
            if (!isValidObjectId(req.query.entityId)) return invalid(res, "Invalid entityId", "INVALID_ENTITY_ID");
            filter.entityId = req.query.entityId;
        }
        if (req.query.action) filter.action = String(req.query.action);
        if (req.query.actor) {
            if (!isValidObjectId(req.query.actor)) return invalid(res, "Invalid actor", "INVALID_ACTOR_ID");
            filter.actor = req.query.actor;
        }
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return invalid(res, "Invalid date range", "INVALID_DATE_RANGE");
        if (from || to) filter.occurredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

        const page = Number.parseInt(req.query.page || "1", 10);
        const limit = Number.parseInt(req.query.limit || "50", 10);
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return invalid(res, "page must be positive and limit must be between 1 and 100", "INVALID_PAGINATION");
        }
        const [data, totalRecords] = await Promise.all([
            AuditLog.find(filter).populate("actor", "username role").sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AuditLog.countDocuments(filter),
        ]);
        return res.status(200).json({ success: true, data, pagination: { page, limit, totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / limit)) } });
    } catch (error) {
        return handleError(res, error, "Get audit history error");
    }
};

const getAuditLog = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid audit ID", "INVALID_AUDIT_ID");
        const record = await AuditLog.findById(req.params.id).populate("actor", "username role").lean();
        return record ? res.status(200).json({ success: true, data: record }) : res.status(404).json({ success: false, message: "Audit record not found", error: "AUDIT_NOT_FOUND" });
    } catch (error) {
        return handleError(res, error, "Get audit record error");
    }
};

module.exports = { listAuditLogs, getAuditLog };
