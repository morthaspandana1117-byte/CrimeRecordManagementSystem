const Case = require("../models/Case");
const FIR = require("../models/FIR");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const CaseHistory = require("../models/CaseHistory");
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
    "Reopened",
];

const validCasePriorities = ["Low", "Medium", "High", "Critical"];
const seniorOfficerRanks = new Set(["inspector", "dsp", "sp"]);

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
        .populate("criminalIds", "criminalId fullName status")
        .populate("investigationHistory.startedBy", "username role")
        .populate("investigationHistory.closedBy", "username role")
        .populate("investigationHistory.reopenedBy", "username role");

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
        reopened: "Reopened",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validCaseStatuses.includes(trimmed) ? trimmed : null;
};

const validateCaseStatus = (value) => normalizeCaseStatus(value) !== null;

const isSeniorAuthority = (req) => seniorOfficerRanks.has(req.authority?.rank);

const canAccessCase = (req, record) =>
    isSeniorAuthority(req) ||
    req.authority?.systemRole === "system_admin" ||
    record.assignedOfficerIds?.some((officerId) =>
        String(officerId?._id || officerId) === String(req.authority?.officer?._id),
    );

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

const appendCaseHistory = async ({
    caseId,
    actionType,
    description,
    performedBy,
    performedByRole,
    performedByRank,
    previousValue,
    newValue,
    metadata,
    performedByOfficer,
}) => {
    if (!caseId || !actionType || !description) {
        return null;
    }

    return CaseHistory.create({
        caseId,
        actionType,
        description,
        performedBy,
        performedByRole,
        performedByRank,
        previousValue: previousValue ?? null,
        newValue: newValue ?? null,
        metadata: metadata ?? null,
        performedByOfficer,
        timestamp: new Date(),
    });
};

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
            { caseNo: { $regex: searchTerm, $options: "i" } },
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
            return "status must be one of: Open, Under Investigation, Court Proceedings, Closed, Reopened";
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

        const startedAt = new Date();
        payload.currentInvestigationRound = 1;
        payload.investigationHistory = [{
            round: 1,
            startedAt,
            startedBy: req.user?.userId,
            status: payload.status === "Closed" ? "Closed" : "Open",
            ...(payload.status === "Closed"
                ? { closedAt: startedAt, closedBy: req.user?.userId }
                : {}),
        }];
        const record = await Case.create(payload);
        await appendCaseHistory({
            caseId: record._id,
            actionType: "case_created",
            description: "Case created",
            performedBy: req.user?.userId,
            performedByRole: req.authority?.systemRole || req.user?.role,
            performedByRank: req.authority?.rank,
            performedByOfficer: req.authority?.officer?._id,
            previousValue: null,
            newValue: {
                caseNo: record.caseNo,
                title: record.title,
                status: record.status,
                priority: record.priority,
            },
            metadata: {
                caseNo: record.caseNo,
                firId: record.firId,
            },
        });
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
        if (req.authority?.rank === "investigating_officer") {
            filter.assignedOfficerIds = req.authority.officer._id;
        }
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
        if (record && !canAccessCase(req, record)) {
            return res.status(403).json({
                success: false,
                message: "You may only access cases assigned to you",
                error: "CASE_ACCESS_DENIED",
            });
        }
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
            Object.entries(req.body).filter(([key]) => fields.includes(key) && key !== "status"),
        );

        const existingRecord = await Case.findById(req.params.id).select("assignedOfficerIds status");
        if (!existingRecord) return notFound(res, "Case");
        if (!canAccessCase(req, existingRecord)) {
            return res.status(403).json({
                success: false,
                message: "You may only update cases assigned to you",
                error: "CASE_ACCESS_DENIED",
            });
        }

        if (existingRecord.status === "Closed") {
            return conflict(res, "Closed cases are read-only. Reopen the case before editing", "CASE_CLOSED_READ_ONLY");
        }

        if (req.body.status !== undefined) {
            return invalid(res, "Use the case status endpoint for lifecycle changes", "USE_CASE_STATUS_ENDPOINT");
        }

        if (!Object.keys(updates).length) {
            return invalid(res, "No valid case fields were provided");
        }

        if (updates.status === "Reopened") {
            return invalid(res, "Use the reopen endpoint to reopen a closed Case", "USE_REOPEN_ENDPOINT");
        }

        if (updates.status && updates.status !== "Closed" && await Case.exists({ _id: req.params.id, status: "Closed" })) {
            return conflict(res, "Use the reopen endpoint before changing a closed Case", "CASE_REOPEN_REQUIRED");
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

        if (record) {
            const changedFields = Object.keys(updates).filter((field) => {
                const previous = existingRecord?.[field];
                const current = record?.[field];
                return JSON.stringify(previous) !== JSON.stringify(current);
            });

            if (changedFields.length) {
                const previousValue = Object.fromEntries(
                    changedFields.map((field) => [field, existingRecord?.[field]]),
                );
                const newValue = Object.fromEntries(
                    changedFields.map((field) => [field, record?.[field]]),
                );

                await appendCaseHistory({
                    caseId: record._id,
                    actionType: "case_updated",
                    description: `Case details updated (${changedFields.join(", ")})`,
                    performedBy: req.user?.userId,
                    performedByRole: req.authority?.systemRole || req.user?.role,
                    performedByRank: req.authority?.rank,
                    performedByOfficer: req.authority?.officer?._id,
                    previousValue,
                    newValue,
                    metadata: { changedFields },
                });
            }
        }

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
        if (!canAccessCase(req, record)) {
            return res.status(403).json({ success: false, message: "You may only manage assigned cases", error: "CASE_ACCESS_DENIED" });
        }
        if (record.status === "Closed") {
            return conflict(res, "Closed cases are read-only. Reopen the case before changing assignments", "CASE_CLOSED_READ_ONLY");
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

        const previousAssignedOfficerIds = record.assignedOfficerIds.map((id) => String(id));
        const updated = await populate(
            Case.findByIdAndUpdate(
                req.params.id,
                { assignedOfficerIds },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        const nextAssignedOfficerIds = assignedOfficerIds.map((id) => String(id));
        const addedOfficers = nextAssignedOfficerIds.filter((id) => !previousAssignedOfficerIds.includes(id));
        const removedOfficers = previousAssignedOfficerIds.filter((id) => !nextAssignedOfficerIds.includes(id));

        for (const officerId of addedOfficers) {
            await appendCaseHistory({
                caseId: record._id,
                actionType: "officer_assigned",
                description: "Officer assigned to case",
                performedBy: req.user?.userId,
                performedByRole: req.authority?.systemRole || req.user?.role,
                performedByRank: req.authority?.rank,
                performedByOfficer: req.authority?.officer?._id,
                previousValue: null,
                newValue: { officerId },
                metadata: { assignmentAction: "assigned" },
            });
        }

        for (const officerId of removedOfficers) {
            await appendCaseHistory({
                caseId: record._id,
                actionType: "officer_unassigned",
                description: "Officer unassigned from case",
                performedBy: req.user?.userId,
                performedByRole: req.authority?.systemRole || req.user?.role,
                performedByRank: req.authority?.rank,
                performedByOfficer: req.authority?.officer?._id,
                previousValue: { officerId },
                newValue: null,
                metadata: { assignmentAction: "unassigned" },
            });
        }

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
                "status must be one of: Open, Under Investigation, Court Proceedings, Closed, Reopened",
                "INVALID_CASE_STATUS",
            );
        }

        if (normalizedStatus === "Reopened") {
            return invalid(res, "Use the reopen endpoint to reopen a closed Case", "USE_REOPEN_ENDPOINT");
        }

        const record = await Case.findById(req.params.id);
        if (!record) return notFound(res, "Case");
        if (!canAccessCase(req, record)) {
            return res.status(403).json({ success: false, message: "You may only manage assigned cases", error: "CASE_ACCESS_DENIED" });
        }

        if (record.status === "Closed") {
            return conflict(res, "Closed cases are read-only. Reopen the case before changing its status", "CASE_CLOSED_READ_ONLY");
        }

        if (!record.currentInvestigationRound) {
            record.currentInvestigationRound = 1;
            record.investigationHistory.push({
                round: 1,
                startedAt: record.startDate || new Date(),
                startedBy: req.user?.userId,
                status: normalizedStatus === "Closed" ? "Closed" : normalizedStatus,
            });
        }

        const previousStatus = record.status;
        const currentRound = record.investigationHistory.find(
            (round) => round.round === record.currentInvestigationRound,
        );
        if (currentRound) {
            currentRound.status = normalizedStatus;
            if (normalizedStatus === "Closed") {
                currentRound.closedAt = new Date();
                currentRound.closedBy = req.user?.userId;
                currentRound.closureReason = typeof req.body.closureReason === "string"
                    ? req.body.closureReason.trim()
                    : undefined;
            }
        }
        record.status = normalizedStatus;
        await record.save();
        await appendCaseHistory({
            caseId: record._id,
            actionType: "case_status_changed",
            description: `Case status changed from ${previousStatus} to ${normalizedStatus}`,
            performedBy: req.user?.userId,
            performedByRole: req.authority?.systemRole || req.user?.role,
            performedByRank: req.authority?.rank,
            performedByOfficer: req.authority?.officer?._id,
            previousValue: { status: previousStatus },
            newValue: { status: normalizedStatus },
            metadata: { previousStatus, newStatus: normalizedStatus },
        });

        const populatedRecord = await populate(
            Case.findById(record._id).select("-__v"),
        );

        return populatedRecord
            ? res.status(200).json({
                  success: true,
                  message: "Case status updated successfully",
                  data: populatedRecord,
              })
            : notFound(res, "Case");
    } catch (error) {
        return handleError(res, error, "Update case status error");
    }
};

const reopenCase = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
        }

        if (!isSeniorAuthority(req)) {
            return res.status(403).json({
                success: false,
                message: "Only Inspector, DSP, or SP officers can reopen a Case",
                error: "INSUFFICIENT_PERMISSIONS",
            });
        }

        const reopenReason = typeof req.body.reopenReason === "string"
            ? req.body.reopenReason.trim()
            : "";
        if (!reopenReason) {
            return invalid(res, "reopenReason is required", "REOPEN_REASON_REQUIRED");
        }

        const record = await Case.findById(req.params.id);
        if (!record) return notFound(res, "Case");
        if (record.status !== "Closed") {
            return conflict(res, "Only a closed Case can be reopened", "CASE_NOT_CLOSED");
        }

        const previousRound = record.investigationHistory.find(
            (round) => round.round === record.currentInvestigationRound,
        );
        if (previousRound) {
            previousRound.status = "Closed";
            previousRound.closedAt ||= new Date();
            previousRound.closedBy ||= req.user.userId;
            previousRound.reopenReason = reopenReason;
            previousRound.reopenedAt = new Date();
            previousRound.reopenedBy = req.user.userId;
        }

        const nextRound = (record.currentInvestigationRound || record.investigationHistory.length || 0) + 1;
        record.currentInvestigationRound = nextRound;
        record.investigationHistory.push({
            round: nextRound,
            startedAt: new Date(),
            startedBy: req.user.userId,
            reopenReason,
            reopenedAt: new Date(),
            reopenedBy: req.user.userId,
            status: "Reopened",
        });
        record.status = "Reopened";
        await record.save();
        await appendCaseHistory({
            caseId: record._id,
            actionType: "case_reopened",
            description: `Case reopened (${reopenReason})`,
            performedBy: req.user?.userId,
            performedByRole: req.authority?.systemRole || req.user?.role,
            performedByRank: req.authority?.rank,
            performedByOfficer: req.authority?.officer?._id,
            previousValue: { status: "Closed" },
            newValue: { status: "Reopened", reopenReason },
            metadata: { reopenReason, reopenedByRole: req.authority?.systemRole || req.user?.role },
        });

        const populatedRecord = await populate(Case.findById(record._id).select("-__v"));
        return res.status(200).json({
            success: true,
            message: "Case reopened successfully",
            data: populatedRecord,
        });
    } catch (error) {
        return handleError(res, error, "Reopen case error");
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

const getCaseHistory = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
        }

        const record = await Case.findById(req.params.id).select("assignedOfficerIds status");
        if (!record) {
            return notFound(res, "Case");
        }

        const isAssignedOfficer = record.assignedOfficerIds?.some(
            (officerId) => String(officerId) === String(req.authority?.officer?._id),
        );
        if (req.authority?.rank === "investigating_officer" && !isAssignedOfficer) {
            return res.status(403).json({
                success: false,
                message: "You may only view history for assigned cases",
                error: "CASE_HISTORY_ACCESS_DENIED",
            });
        }

        if (req.authority?.systemRole === "system_admin") {
            return res.status(403).json({
                success: false,
                message: "System admin users do not have operational case history access",
                error: "CASE_HISTORY_ACCESS_DENIED",
            });
        }

        const timeline = await CaseHistory.find({ caseId: req.params.id })
            .sort({ timestamp: 1 })
            .populate("performedBy", "username role")
            .populate("performedByOfficer", "name officerId rank")
            .lean();

        return res.status(200).json({
            success: true,
            count: timeline.length,
            data: timeline,
        });
    } catch (error) {
        return handleError(res, error, "Get case history error");
    }
};

module.exports = {
    createCase,
    getAllCases,
    getCaseById,
    updateCase,
    assignCaseOfficers,
    updateCaseStatus,
    reopenCase,
    deleteCase,
    getCaseHistory,
    appendCaseHistory,
    normalizeCaseStatus,
    validateCaseStatus,
    normalizeCasePriority,
    validateCasePriority,
    buildCaseQueryFilters,
    validateCase,
};
