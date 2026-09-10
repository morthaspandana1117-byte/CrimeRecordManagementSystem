const Case = require("../models/Case");
const FIR = require("../models/FIR");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    conflict,
    validateReference,
    validateReferences,
    handleError,
} = require("./controllerUtils");

const validCaseStatuses = [
    "Open",
    "Under Investigation",
    "Court Proceedings",
    "Closed",
];

const validCasePriorities = ["Low", "Medium", "High", "Critical"];

const fields = [
    "caseNo",
    "firId",
    "assignedOfficerIds",
    "criminalIds",
    "title",
    "description",
    "startDate",
    "status",
    "priority",
    "investigationNotes",
];

const required = [
    "caseNo",
    "firId",
    "title",
    "description",
    "startDate",
    "status",
    "priority",
];

const populate = (query) =>
    query
        .populate("firId", "firNo date policeStation crimeType status")
        .populate(
            "assignedOfficerIds",
            "officerId name rank department station status",
        )
        .populate("criminalIds", "criminalId fullName status");

const normalizeCaseStatus = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.toLowerCase();
    const aliases = {
        open: "Open",
        "under investigation": "Under Investigation",
        "court proceedings": "Court Proceedings",
        closed: "Closed",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validCaseStatuses.includes(trimmed) ? trimmed : null;
};

const validateCaseStatus = (value) => normalizeCaseStatus(value) !== null;

const normalizeCasePriority = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.toLowerCase();
    const aliases = {
        low: "Low",
        medium: "Medium",
        high: "High",
        critical: "Critical",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validCasePriorities.includes(trimmed) ? trimmed : null;
};

const validateCasePriority = (value) => normalizeCasePriority(value) !== null;

const buildCaseQueryFilters = ({ search, status, priority } = {}) => {
    const filter = {};

    if (status !== undefined) {
        const normalizedStatus = normalizeCaseStatus(status);
        if (normalizedStatus === null) {
            return { valid: false, error: "INVALID_CASE_STATUS" };
        }
        filter.status = normalizedStatus;
    }

    if (priority !== undefined) {
        const normalizedPriority = normalizeCasePriority(priority);
        if (normalizedPriority === null) {
            return { valid: false, error: "INVALID_CASE_PRIORITY" };
        }
        filter.priority = normalizedPriority;
    }

    const searchTerm = typeof search === "string" ? search.trim() : "";
    if (searchTerm) {
        filter.$or = [
            { title: { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
        ];
    }

    return { valid: true, filter };
};

const validateCaseOfficerEligibility = async (res, officerIds) => {
    if (!Array.isArray(officerIds) || officerIds.length === 0) {
        return false;
    }

    if (new Set(officerIds.map((value) => String(value))).size !== officerIds.length) {
        invalid(res, "assignedOfficerIds contains duplicate values", "INVALID_ASSIGNED_OFFICER_IDS");
        return false;
    }

    for (const officerId of officerIds) {
        if (!isValidObjectId(officerId)) {
            invalid(res, "assignedOfficerIds contains an invalid ObjectId", "INVALID_ASSIGNED_OFFICER_IDS");
            return false;
        }

        const officer = await Officer.findById(officerId).populate("userId", "status isActive role");
        if (!officer) {
            notFound(res, "Officer");
            return false;
        }

        if (officer.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Officer is not eligible to be assigned to a case",
                error: "OFFICER_INELIGIBLE",
            });
        }

        if (!officer.userId || officer.userId.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Officer account is inactive",
                error: "OFFICER_INACTIVE",
            });
        }

        const userStatus = officer.userId.status || "approved";
        if (officer.userId.role === "officer" && userStatus !== "approved") {
            return res.status(403).json({
                success: false,
                message: "Officer account is not approved",
                error: "OFFICER_NOT_APPROVED",
            });
        }
    }

    return true;
};

const validateCase = async (res, body, partial = false) => {
    if (
        !partial &&
        required.some(
            (field) =>
                body[field] === undefined ||
                body[field] === null ||
                (typeof body[field] === "string" && body[field].trim() === ""),
        )
    ) {
        return "All required case fields must be provided";
    }

    if ((!partial || body.caseNo !== undefined) && !isNonEmptyString(body.caseNo)) {
        return "caseNo must not be empty";
    }

    if ((!partial || body.title !== undefined) && !isNonEmptyString(body.title)) {
        return "title must not be empty";
    }

    if ((!partial || body.description !== undefined) && !isNonEmptyString(body.description)) {
        return "description must not be empty";
    }

    if ((!partial || body.startDate !== undefined) && !isValidDate(body.startDate)) {
        return "startDate must be a valid date";
    }

    if (body.status !== undefined) {
        const normalizedStatus = normalizeCaseStatus(body.status);
        if (normalizedStatus === null) {
            return "status must be one of: Open, Under Investigation, Court Proceedings, Closed";
        }
        body.status = normalizedStatus;
    }

    if (body.priority !== undefined) {
        const normalizedPriority = normalizeCasePriority(body.priority);
        if (normalizedPriority === null) {
            return "priority must be one of: Low, Medium, High, Critical";
        }
        body.priority = normalizedPriority;
    }

    const isExpressResponse = !!(res && typeof res.status === "function");

    if (body.firId !== undefined && isExpressResponse) {
        const validReference = await validateReference(res, FIR, body.firId, "firId");
        if (!validReference) return null;
    }

    if (body.assignedOfficerIds !== undefined) {
        const officerIds = Array.isArray(body.assignedOfficerIds) ? body.assignedOfficerIds : [body.assignedOfficerIds];
        if (officerIds.some((value) => !isValidObjectId(value))) {
            return "assignedOfficerIds contains an invalid ObjectId";
        }

        if (new Set(officerIds.map((value) => String(value))).size !== officerIds.length) {
            return "assignedOfficerIds contains duplicate values";
        }

        if (isExpressResponse) {
            const officersValid = await validateCaseOfficerEligibility(res, officerIds);
            if (!officersValid) return null;
        }
    }

    if (body.criminalIds !== undefined) {
        if (!Array.isArray(body.criminalIds) || body.criminalIds.length === 0) {
            return "criminalIds must be a non-empty array";
        }

        if (new Set(body.criminalIds.map((value) => String(value))).size !== body.criminalIds.length) {
            return "criminalIds contains duplicate values";
        }

        if (body.criminalIds.some((value) => !isValidObjectId(value))) {
            return "criminalIds contains an invalid ObjectId";
        }

        if (isExpressResponse && !(await validateReferences(res, Criminal, body.criminalIds, "criminalIds"))) {
            return null;
        }
    }

    return "OK";
};

const createCase = async (req, res) => {
    try {
        const payload = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

        if (!payload.firId) {
            return invalid(res, "firId is required", "INVALID_FIR_ID");
        }

        const result = await validateCase(res, payload);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        if (await Case.exists({ firId: payload.firId })) {
            return conflict(
                res,
                "A case already exists for this FIR",
                "FIR_CASE_ALREADY_EXISTS",
            );
        }

        if (payload.caseNo && (await Case.exists({ caseNo: payload.caseNo }))) {
            return conflict(
                res,
                "A case with this case number already exists",
                "CASE_NUMBER_ALREADY_EXISTS",
            );
        }

        const record = await Case.create(payload);
        const populatedRecord = await populate(Case.findById(record._id).select("-__v"));

        return res.status(201).json({
            success: true,
            message: "Case created successfully",
            data: populatedRecord,
        });
    } catch (error) {
        return handleError(res, error, "Create case error");
    }
};

const getAllCases = async (req, res) => {
    try {
        const query = buildCaseQueryFilters({
            search: req.query.search,
            status: req.query.status,
            priority: req.query.priority,
        });

        if (!query.valid) {
            return invalid(res, "Invalid case filter", query.error);
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

        const totalRecords = await Case.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const records = await populate(
            Case.find(filter)
                .select("-__v")
                .sort({ createdAt: -1 })
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
        return handleError(res, error, "Get cases error");
    }
};

const getCaseById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");

        const record = await populate(Case.findById(req.params.id).select("-__v"));
        return record
            ? res.status(200).json({ success: true, data: record })
            : notFound(res, "Case");
    } catch (error) {
        return handleError(res, error, "Get case error");
    }
};

const updateCase = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");

        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

        if (!Object.keys(updates).length) {
            return invalid(res, "No valid case fields were provided");
        }

        const result = await validateCase(res, updates, true);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        if (
            updates.firId &&
            (await Case.exists({
                firId: updates.firId,
                _id: { $ne: req.params.id },
            }))
        ) {
            return conflict(
                res,
                "A case already exists for this FIR",
                "FIR_CASE_ALREADY_EXISTS",
            );
        }

        if (updates.caseNo) {
            const duplicateCase = await Case.exists({
                caseNo: updates.caseNo,
                _id: { $ne: req.params.id },
            });
            if (duplicateCase) {
                return conflict(
                    res,
                    "A case with this case number already exists",
                    "CASE_NUMBER_ALREADY_EXISTS",
                );
            }
        }

        const record = await populate(
            Case.findByIdAndUpdate(req.params.id, updates, {
                new: true,
                runValidators: true,
            }).select("-__v"),
        );

        return record
            ? res.status(200).json({
                  success: true,
                  message: "Case updated successfully",
                  data: record,
              })
            : notFound(res, "Case");
    } catch (error) {
        return handleError(res, error, "Update case error");
    }
};

const assignCaseOfficers = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
        }

        const record = await Case.findById(req.params.id).select("-__v");
        if (!record) {
            return notFound(res, "Case");
        }

        const assignedOfficerIds = Array.isArray(req.body.assignedOfficerIds)
            ? req.body.assignedOfficerIds
            : [req.body.assignedOfficerIds];

        if (!assignedOfficerIds.length || assignedOfficerIds.some((value) => value === undefined || value === null || value === "")) {
            return invalid(res, "assignedOfficerIds must contain valid officer IDs", "INVALID_ASSIGNED_OFFICER_IDS");
        }

        if (new Set(assignedOfficerIds.map((value) => String(value))).size !== assignedOfficerIds.length) {
            return invalid(res, "assignedOfficerIds contains duplicate values", "INVALID_ASSIGNED_OFFICER_IDS");
        }

        const valid = await validateCaseOfficerEligibility(res, assignedOfficerIds);
        if (!valid) return undefined;

        const updated = await populate(
            Case.findByIdAndUpdate(
                req.params.id,
                { assignedOfficerIds },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        return res.status(200).json({
            success: true,
            message: "Assigned officers updated successfully",
            data: updated,
        });
    } catch (error) {
        return handleError(res, error, "Assign case officers error");
    }
};

const updateCaseStatus = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
        }

        const normalizedStatus = normalizeCaseStatus(req.body.status);
        if (normalizedStatus === null) {
            return invalid(
                res,
                "status must be one of: Open, Under Investigation, Court Proceedings, Closed",
                "INVALID_CASE_STATUS",
            );
        }

        const record = await populate(
            Case.findByIdAndUpdate(
                req.params.id,
                { status: normalizedStatus },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        return record
            ? res.status(200).json({
                  success: true,
                  message: "Case status updated successfully",
                  data: record,
              })
            : notFound(res, "Case");
    } catch (error) {
        return handleError(res, error, "Update case status error");
    }
};

const deleteCase = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
        const record = await Case.findByIdAndDelete(req.params.id);
        return record
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "Case deleted successfully",
                      data: { id: record._id },
                  })
            : notFound(res, "Case");
    } catch (error) {
        return handleError(res, error, "Delete case error");
    }
};

module.exports = {
    createCase,
    getAllCases,
    getCaseById,
    updateCase,
    assignCaseOfficers,
    updateCaseStatus,
    deleteCase,
    normalizeCaseStatus,
    validateCaseStatus,
    normalizeCasePriority,
    validateCasePriority,
    buildCaseQueryFilters,
    validateCase,
};
