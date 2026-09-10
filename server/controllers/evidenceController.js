const Evidence = require("../models/Evidence");
const Case = require("../models/Case");
const Officer = require("../models/Officer");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    validateReference,
    handleError,
} = require("./controllerUtils");

const validEvidenceStatuses = [
    "Collected",
    "Under Examination",
    "Verified",
    "Stored",
    "Released",
    "Disposed",
];

const validEvidenceTypes = [
    "Document",
    "Photograph",
    "Video",
    "Weapon",
    "Biological",
    "Digital",
    "Physical",
    "Other",
];

const fields = [
    "evidenceId",
    "caseId",
    "type",
    "description",
    "collectedBy",
    "collectionDate",
    "location",
    "fileUrl",
    "status",
];

const required = [
    "evidenceId",
    "caseId",
    "type",
    "description",
    "collectedBy",
    "collectionDate",
    "location",
    "status",
];

const populate = (query) =>
    query
        .populate("caseId", "caseNo title status")
        .populate(
            "collectedBy",
            "officerId name rank department station status userId",
        );

const normalizeEvidenceStatus = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.toLowerCase();
    const aliases = {
        collected: "Collected",
        "under examination": "Under Examination",
        verified: "Verified",
        stored: "Stored",
        released: "Released",
        disposed: "Disposed",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validEvidenceStatuses.includes(trimmed) ? trimmed : null;
};

const validateEvidenceStatus = (value) => normalizeEvidenceStatus(value) !== null;

const normalizeEvidenceType = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.toLowerCase();
    const aliases = {
        document: "Document",
        photo: "Photograph",
        photograph: "Photograph",
        video: "Video",
        weapon: "Weapon",
        biological: "Biological",
        digital: "Digital",
        physical: "Physical",
        other: "Other",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validEvidenceTypes.includes(trimmed) ? trimmed : null;
};

const validateEvidenceType = (value) => normalizeEvidenceType(value) !== null;

const buildEvidenceQueryFilters = ({ search, status, type, caseId, collectedBy } = {}) => {
    const filter = {};

    if (status !== undefined) {
        const normalizedStatus = normalizeEvidenceStatus(status);
        if (normalizedStatus === null) {
            return { valid: false, error: "INVALID_EVIDENCE_STATUS" };
        }
        filter.status = normalizedStatus;
    }

    if (type !== undefined) {
        const normalizedType = normalizeEvidenceType(type);
        if (normalizedType === null) {
            return { valid: false, error: "INVALID_EVIDENCE_TYPE" };
        }
        filter.type = normalizedType;
    }

    if (caseId !== undefined) {
        if (!isValidObjectId(caseId)) {
            return { valid: false, error: "INVALID_CASE_ID" };
        }
        filter.caseId = caseId;
    }

    if (collectedBy !== undefined) {
        if (!isValidObjectId(collectedBy)) {
            return { valid: false, error: "INVALID_COLLECTED_BY" };
        }
        filter.collectedBy = collectedBy;
    }

    const searchTerm = typeof search === "string" ? search.trim() : "";
    if (searchTerm) {
        filter.$or = [
            { evidenceId: { $regex: searchTerm, $options: "i" } },
            { type: { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
        ];
    }

    return { valid: true, filter };
};

const ensureEligibleOfficer = async (res, officerId) => {
    const officer = await Officer.findById(officerId).populate("userId", "status isActive role");

    if (!officer) {
        return { valid: false, response: notFound(res, "Officer") };
    }

    if (officer.status !== "active") {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer is not eligible to collect evidence",
                error: "OFFICER_INELIGIBLE",
            }),
        };
    }

    if (!officer.userId || officer.userId.isActive === false) {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer account is inactive",
                error: "OFFICER_INACTIVE",
            }),
        };
    }

    if (officer.userId.role === "officer" && (officer.userId.status || "approved") !== "approved") {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer account is not approved",
                error: "OFFICER_NOT_APPROVED",
            }),
        };
    }

    return { valid: true, officer };
};

const validateEvidence = async (res, body, partial = false) => {
    if (
        !partial &&
        required.some(
            (field) =>
                body[field] === undefined ||
                body[field] === null ||
                (typeof body[field] === "string" && body[field].trim() === ""),
        )
    ) {
        return "All required evidence fields must be provided";
    }

    if ((!partial || body.evidenceId !== undefined) && !isNonEmptyString(body.evidenceId)) {
        return "evidenceId must not be empty";
    }

    const isExpressResponse = !!(
        res &&
        typeof res.status === "function" &&
        typeof res.json === "function"
    );

    if ((!partial || body.caseId !== undefined) && body.caseId !== undefined && isExpressResponse) {
        const validCase = await validateReference(res, Case, body.caseId, "caseId");
        if (!validCase) return null;
    }

    if ((!partial || body.type !== undefined) && body.type !== undefined) {
        const normalizedType = normalizeEvidenceType(body.type);
        if (normalizedType === null) {
            return "type must be one of: Document, Photograph, Video, Weapon, Biological, Digital, Physical, Other";
        }
        body.type = normalizedType;
    }

    if ((!partial || body.description !== undefined) && body.description !== undefined && !isNonEmptyString(body.description)) {
        return "description must not be empty";
    }

    if (body.collectedBy !== undefined) {
        if (!isValidObjectId(body.collectedBy)) {
            return "collectedBy must be a valid ObjectId";
        }

        if (isExpressResponse) {
            const officerCheck = await ensureEligibleOfficer(res, body.collectedBy);
            if (!officerCheck.valid) return null;
        }
    }

    if ((!partial || body.collectionDate !== undefined) && body.collectionDate !== undefined && !isValidDate(body.collectionDate)) {
        return "collectionDate must be a valid date";
    }

    if ((!partial || body.location !== undefined) && body.location !== undefined && !isNonEmptyString(body.location)) {
        return "location must not be empty";
    }

    if (body.status !== undefined) {
        const normalizedStatus = normalizeEvidenceStatus(body.status);
        if (normalizedStatus === null) {
            return "status must be one of: Collected, Under Examination, Verified, Stored, Released, Disposed";
        }
        body.status = normalizedStatus;
    }

    if (body.fileUrl !== undefined && body.fileUrl !== "" && !/^https?:\/\//i.test(String(body.fileUrl).trim())) {
        return "fileUrl must be a valid HTTP URL";
    }

    return "OK";
};

const createEvidence = async (req, res) => {
    try {
        const payload = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

        const result = await validateEvidence(res, payload);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        const record = await Evidence.create(payload);
        const populatedRecord = await populate(Evidence.findById(record._id).select("-__v"));

        return res.status(201).json({
            success: true,
            message: "Evidence created successfully",
            data: populatedRecord,
        });
    } catch (error) {
        return handleError(res, error, "Create evidence error");
    }
};

const getAllEvidence = async (req, res) => {
    try {
        const query = buildEvidenceQueryFilters({
            search: req.query.search,
            status: req.query.status,
            type: req.query.type,
            caseId: req.query.caseId,
            collectedBy: req.query.collectedBy,
        });

        if (!query.valid) {
            return invalid(res, "Invalid evidence filter", query.error);
        }

        const filter = query.filter;
        const page = Number.parseInt(req.query.page ?? "1", 10);
        const limit = Number.parseInt(req.query.limit ?? "10", 10);

        if (!Number.isInteger(page) || page < 1) {
            return invalid(res, "page must be a positive integer", "INVALID_PAGE");
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return invalid(
                res,
                "limit must be an integer between 1 and 100",
                "INVALID_LIMIT",
            );
        }

        const totalRecords = await Evidence.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const records = await populate(
            Evidence.find(filter)
                .select("-__v")
                .sort({ collectionDate: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
        );

        return res.status(200).json({
            success: true,
            count: records.length,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages,
            },
            data: records,
        });
    } catch (error) {
        return handleError(res, error, "Get evidence error");
    }
};

const getEvidenceById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");

        const record = await populate(Evidence.findById(req.params.id).select("-__v"));
        return record
            ? res.status(200).json({ success: true, data: record })
            : notFound(res, "Evidence");
    } catch (error) {
        return handleError(res, error, "Get evidence error");
    }
};

const updateEvidence = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");

        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

        if (!Object.keys(updates).length) {
            return invalid(res, "No valid evidence fields were provided");
        }

        const result = await validateEvidence(res, updates, true);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        const record = await populate(
            Evidence.findByIdAndUpdate(req.params.id, updates, {
                new: true,
                runValidators: true,
            }).select("-__v"),
        );

        return record
            ? res.status(200).json({
                  success: true,
                  message: "Evidence updated successfully",
                  data: record,
              })
            : notFound(res, "Evidence");
    } catch (error) {
        return handleError(res, error, "Update evidence error");
    }
};

const updateEvidenceStatus = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");
        }

        const normalizedStatus = normalizeEvidenceStatus(req.body.status);
        if (normalizedStatus === null) {
            return invalid(
                res,
                "status must be one of: Collected, Under Examination, Verified, Stored, Released, Disposed",
                "INVALID_EVIDENCE_STATUS",
            );
        }

        const record = await populate(
            Evidence.findByIdAndUpdate(
                req.params.id,
                { status: normalizedStatus },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        return record
            ? res.status(200).json({
                  success: true,
                  message: "Evidence status updated successfully",
                  data: record,
              })
            : notFound(res, "Evidence");
    } catch (error) {
        return handleError(res, error, "Update evidence status error");
    }
};

const deleteEvidence = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");

        const record = await Evidence.findByIdAndDelete(req.params.id);
        return record
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "Evidence deleted successfully",
                      data: { id: record._id },
                  })
            : notFound(res, "Evidence");
    } catch (error) {
        return handleError(res, error, "Delete evidence error");
    }
};

module.exports = {
    createEvidence,
    getAllEvidence,
    getEvidenceById,
    updateEvidence,
    updateEvidenceStatus,
    deleteEvidence,
    normalizeEvidenceStatus,
    validateEvidenceStatus,
    normalizeEvidenceType,
    validateEvidenceType,
    buildEvidenceQueryFilters,
    validateEvidence,
};
