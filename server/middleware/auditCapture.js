const auditService = require("../services/auditService");

const RESOURCE_MODELS = {
    officers: ["Officer", "../models/Officer"],
    criminals: ["Criminal", "../models/Criminal"],
    firs: ["FIR", "../models/FIR"],
    cases: ["Case", "../models/Case"],
    evidence: ["Evidence", "../models/Evidence"],
    reports: ["Report", "../models/Report"],
};

const actionFor = (method, path, entityType, body) => {
    const verb = method.toUpperCase();
    if (entityType === "Evidence" && verb === "POST" && /\/custody\/transfer\/?$/.test(path)) {
        return "EVIDENCE_CUSTODY_TRANSFERRED";
    }
    if (entityType === "Evidence" && /\/verify\/?$/.test(path)) {
        const verificationStatus = String(body?.verificationStatus || "verified").toLowerCase();
        return verificationStatus === "rejected" ? "EVIDENCE_REJECTED" : "EVIDENCE_VERIFIED";
    }
    if (entityType === "Evidence" && /\/status\/?$/.test(path)) {
        if (body?.status === "Verified") return "EVIDENCE_VERIFIED";
        if (body?.status === "Rejected") return "EVIDENCE_REJECTED";
        return "EVIDENCE_STATUS_CHANGED";
    }
    if (entityType === "Case" && /\/status\/?$/.test(path)) return "CASE_STATUS_CHANGED";
    if (entityType === "Case" && /\/reopen\/?$/.test(path)) return "CASE_REOPENED";
    if (entityType === "Case" && /\/assign-officers\/?$/.test(path)) return "CASE_OFFICERS_ASSIGNED";
    if (entityType === "Officer" && /\/approve\/?$/.test(path)) return "OFFICER_APPROVED";
    if (entityType === "Officer" && /\/reject\/?$/.test(path)) return "OFFICER_REJECTED";
    if (entityType === "Officer" && /\/status\/?$/.test(path)) return "OFFICER_STATUS_CHANGED";
    if (entityType === "Criminal" && /\/status\/?$/.test(path)) return "CRIMINAL_STATUS_CHANGED";
    if (entityType === "FIR" && /\/status\/?$/.test(path)) return "FIR_STATUS_CHANGED";
    if (verb === "POST") return `${entityType.toUpperCase()}_CREATED`;
    if (verb === "DELETE") return `${entityType.toUpperCase()}_DELETED`;
    return `${entityType.toUpperCase()}_UPDATED`;
};

const auditCapture = async (req, res, next) => {
    const resourceName = req.baseUrl.split("/").filter(Boolean).at(-1);
    const resource = RESOURCE_MODELS[resourceName];
    const method = req.method.toUpperCase();
    if (!resource || !["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();

    const [entityType, modelPath] = resource;
    const Model = require(modelPath);
    const firstRoutePart = req.path.split("/").filter(Boolean)[0];
    const entityId = firstRoutePart && firstRoutePart !== "status" && firstRoutePart !== "reopen" && firstRoutePart !== "assign-officers"
        ? firstRoutePart
        : undefined;
    let before;
    if (entityId) {
        try {
            before = await Model.findById(entityId).lean();
        } catch (error) {
            console.error("Audit before-snapshot failed:", error.message);
        }
    }

    const sendJson = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode < 200 || res.statusCode >= 300 || body?.success === false) return sendJson(body);

        const actor = req.authority?.user?._id || req.user?.userId;
        const after = body?.data && !Array.isArray(body.data) ? body.data : undefined;
        const resolvedId = entityId || after?._id || after?.id;
        auditService.log({
            actor,
            action: actionFor(method, req.path, entityType, req.body),
            entityType,
            entityId: resolvedId,
            before,
            after,
            method,
            path: req.baseUrl + req.path,
        }).then(() => sendJson(body)).catch((error) => {
            console.error("Audit logging failed:", error.message);
            sendJson(body);
        });
        return res;
    };
    return next();
};

module.exports = auditCapture;
