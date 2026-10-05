const Evidence = require("../models/Evidence");
const EvidenceCustodyHistory = require("../models/EvidenceCustodyHistory");
const Case = require("../models/Case");
const Officer = require("../models/Officer");
const CaseHistory = require("../models/CaseHistory");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    conflict,
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
    "verificationStatus",
    "verificationNotes",
];

const updateFields = ["description", "location", "fileUrl"];
const serverControlledEvidenceFields = [
    "createdBy",
    "updatedBy",
    "currentCustodian",
    "verificationStatus",
    "verifiedBy",
    "verifiedAt",
    "verificationNotes",
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

const rejectServerControlledFields = (res, body, endpointName) => {
    const forbiddenFields = Object.keys(body || {}).filter((field) =>
        serverControlledEvidenceFields.includes(field),
    );

    if (forbiddenFields.length > 0) {
        return invalid(
            res,
            `The following fields are server-controlled and cannot be set via ${endpointName}: ${forbiddenFields.join(", ")}`,
            "FORBIDDEN_EVIDENCE_FIELD",
        );
    }

    return null;
};

const populate = (query) =>
    query
        .populate("caseId", "caseNo title status")
        .populate(
            "collectedBy",
            "officerId name rank department station status userId",
        )
        .populate(
            "currentCustodian",
            "officerId name rank department station status userId",
        )
        .populate("createdBy", "username role")
        .populate("updatedBy", "username role");

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

const normalizeVerificationStatus = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (["unverified", "verified", "rejected"].includes(normalized)) {
        return normalized;
    }
    return null;
};

const appendCaseHistory = async ({ caseId, actionType, description, performedBy, performedByRole, performedByRank, previousValue, newValue, metadata }) => {
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
        timestamp: new Date(),
    });
};

const canAccessCase = (req, caseRecord) =>
    req.authority?.rank !== "investigating_officer" ||
    caseRecord?.assignedOfficerIds?.some((officerId) =>
        String(officerId) === String(req.authority?.officer?._id),
    );

const buildEvidenceQueryFilters = ({ search, status, type, caseId, investigationRound, collectedBy, collectionDateFrom, collectionDateTo } = {}) => {
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

    if (investigationRound !== undefined) {
        const round = Number(investigationRound);
        if (!Number.isInteger(round) || round < 1) {
            return { valid: false, error: "INVALID_INVESTIGATION_ROUND" };
        }
        filter.investigationRound = round;
    }

    if (collectedBy !== undefined) {
        if (!isValidObjectId(collectedBy)) {
            return { valid: false, error: "INVALID_COLLECTED_BY" };
        }
        filter.collectedBy = collectedBy;
    }

    if (collectionDateFrom !== undefined || collectionDateTo !== undefined) {
        const collectionDate = {};
        if (collectionDateFrom !== undefined) {
            if (!isValidDate(collectionDateFrom)) return { valid: false, error: "INVALID_COLLECTION_DATE_FROM" };
            collectionDate.$gte = new Date(collectionDateFrom);
        }
        if (collectionDateTo !== undefined) {
            if (!isValidDate(collectionDateTo)) return { valid: false, error: "INVALID_COLLECTION_DATE_TO" };
            collectionDate.$lte = new Date(collectionDateTo);
        }
        filter.collectionDate = collectionDate;
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

const appendEvidenceCustodyEntry = async ({ evidenceId, caseId, action, fromCustodian, toCustodian, performedBy, performedByOfficer, remarks }) => {
    if (!evidenceId || !caseId || !action) return null;

    return EvidenceCustodyHistory.create({
        evidenceId,
        caseId,
        action,
        fromCustodian: fromCustodian || null,
        toCustodian: toCustodian || null,
        performedBy,
        performedByOfficer,
        remarks: remarks || undefined,
        timestamp: new Date(),
    });
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

    if (body.verificationStatus !== undefined) {
        const normalizedVerificationStatus = normalizeVerificationStatus(body.verificationStatus);
        if (normalizedVerificationStatus === null) {
            return "verificationStatus must be one of: unverified, verified, rejected";
        }
        body.verificationStatus = normalizedVerificationStatus;
    }

    return "OK";
};

const createEvidence = async (req, res) => {
    try {
        if (req.body.collectedBy && req.authority?.officer?._id) {
            const requestedCollector = String(req.body.collectedBy);
            const authenticatedOfficerId = String(req.authority.officer._id);
            if (requestedCollector !== authenticatedOfficerId) {
                return res.status(403).json({
                    success: false,
                    message: "Evidence collector must match the authenticated officer identity",
                    error: "COLLECTED_BY_IMPERSONATION",
                });
            }
        }

        const forbiddenResponse = rejectServerControlledFields(res, req.body, "createEvidence");
        if (forbiddenResponse) return forbiddenResponse;

        const payload = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

        payload.collectedBy = req.authority?.officer?._id || payload.collectedBy;

        const result = await validateEvidence(res, payload);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        const caseRecord = await Case.findById(payload.caseId);
        if (!caseRecord) return notFound(res, "Case");
        if (!canAccessCase(req, caseRecord)) {
            return res.status(403).json({ success: false, message: "You may only add evidence to assigned cases", error: "CASE_ACCESS_DENIED" });
        }
        if (caseRecord.status === "Closed") {
            return res.status(409).json({
                success: false,
                message: "Reopen the Case before adding new Evidence",
                error: "CASE_CLOSED",
            });
        }

        if (!caseRecord.currentInvestigationRound) {
            caseRecord.currentInvestigationRound = 1;
            caseRecord.investigationHistory.push({
                round: 1,
                startedAt: caseRecord.startDate || new Date(),
                startedBy: req.user?.userId,
                status: caseRecord.status === "Reopened" ? "Reopened" : caseRecord.status,
            });
            await caseRecord.save();
        }

        payload.investigationRound = caseRecord.currentInvestigationRound;
        payload.createdBy = req.user?.userId;
        payload.verificationStatus = payload.verificationStatus || "unverified";

        const resultAfterAuth = await validateEvidence(res, payload);
        if (resultAfterAuth !== "OK") return resultAfterAuth ? invalid(res, resultAfterAuth) : undefined;

        payload.currentCustodian = payload.collectedBy;

        const record = await Evidence.create(payload);
        await appendCaseHistory({
            caseId: record.caseId,
            actionType: "evidence_added",
            description: `Evidence added: ${record.evidenceId}`,
            performedBy: req.user?.userId,
            performedByRole: req.authority?.systemRole || req.user?.role,
            performedByRank: req.authority?.rank,
            previousValue: null,
            newValue: { evidenceId: record.evidenceId, investigationRound: record.investigationRound, status: record.status },
            metadata: { evidenceId: record.evidenceId, caseId: record.caseId.toString() },
        });
        const populatedRecord = await populate(Evidence.findById(record._id).select("-__v"));

        return res.status(201).json({
            success: true,
            message: "Evidence created successfully",
            data: populatedRecord,
        });
    } catch (error) {
        if (error.code === 11000 && error.keyPattern?.evidenceId) {
            return conflict(res, "Evidence ID already exists", "EVIDENCE_ID_ALREADY_EXISTS");
        }
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
            investigationRound: req.query.investigationRound,
            collectedBy: req.query.collectedBy,
            collectionDateFrom: req.query.collectionDateFrom,
            collectionDateTo: req.query.collectionDateTo,
        });

        if (!query.valid) {
            return invalid(res, "Invalid evidence filter", query.error);
        }

        const filter = query.filter;
        if (req.authority?.rank === "investigating_officer") {
            const assignedCases = await Case.find({ assignedOfficerIds: req.authority.officer._id }).select("_id");
            filter.caseId = { $in: assignedCases.map((record) => record._id) };
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

        const rawRecord = await Evidence.findById(req.params.id).select("-__v");
        if (rawRecord) {
            const caseRecord = await Case.findById(rawRecord.caseId).select("assignedOfficerIds");
            if (!canAccessCase(req, caseRecord)) {
                return res.status(403).json({ success: false, message: "You may only access evidence for assigned cases", error: "CASE_ACCESS_DENIED" });
            }
        }
        const record = await populate(rawRecord ? Evidence.findById(req.params.id).select("-__v") : Evidence.findById(req.params.id));
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

        const existingRecord = await Evidence.findById(req.params.id).select("caseId");
        if (!existingRecord) return notFound(res, "Evidence");
        const existingCase = await Case.findById(existingRecord.caseId).select("assignedOfficerIds");
        if (!canAccessCase(req, existingCase)) {
            return res.status(403).json({ success: false, message: "You may only update evidence for assigned cases", error: "CASE_ACCESS_DENIED" });
        }

        const forbiddenResponse = rejectServerControlledFields(res, req.body, "updateEvidence");
        if (forbiddenResponse) return forbiddenResponse;

        if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
            return invalid(
                res,
                "status must be updated via the dedicated evidence status endpoint",
                "INVALID_EVIDENCE_STATUS_ROUTE",
            );
        }

        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => updateFields.includes(key)),
        );

        if (!Object.keys(updates).length) {
            return invalid(res, "No valid evidence fields were provided");
        }

        const result = await validateEvidence(res, updates, true);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        updates.updatedBy = req.user?.userId;
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

        const existingRecord = await Evidence.findById(req.params.id).select("caseId");
        if (!existingRecord) return notFound(res, "Evidence");
        const existingCase = await Case.findById(existingRecord.caseId).select("assignedOfficerIds");
        if (!canAccessCase(req, existingCase)) {
            return res.status(403).json({ success: false, message: "You may only update evidence for assigned cases", error: "CASE_ACCESS_DENIED" });
        }

        const forbiddenResponse = rejectServerControlledFields(res, req.body, "updateEvidenceStatus");
        if (forbiddenResponse) return forbiddenResponse;

        const normalizedStatus = normalizeEvidenceStatus(req.body.status);
        if (normalizedStatus === null) {
            return invalid(
                res,
                "status must be one of: Collected, Under Examination, Verified, Stored, Released, Disposed",
                "INVALID_EVIDENCE_STATUS",
            );
        }

        if (normalizedStatus === "Verified") {
            return res.status(409).json({
                success: false,
                message: "Evidence can only be marked verified through the dedicated verification endpoint",
                error: "VERIFICATION_REQUIRED",
            });
        }

        const currentRecord = await Evidence.findById(req.params.id).select("status evidenceId caseId verificationStatus");
        const previousStatus = currentRecord?.status || null;
        const record = await populate(
            Evidence.findByIdAndUpdate(
                req.params.id,
                { status: normalizedStatus, updatedBy: req.user?.userId },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        if (record) {
            await appendCaseHistory({
                caseId: record.caseId?._id || record.caseId,
                actionType: "evidence_status_changed",
                description: `Evidence status changed: ${record.evidenceId}`,
                performedBy: req.user?.userId,
                performedByRole: req.authority?.systemRole || req.user?.role,
                performedByRank: req.authority?.rank,
                previousValue: { status: previousStatus },
                newValue: { status: normalizedStatus },
                metadata: { evidenceId: record.evidenceId, previousStatus, newStatus: normalizedStatus },
            });
        }

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

const downloadEvidence = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");
        }

        const evidence = await Evidence.findById(req.params.id).select("-__v");
        if (!evidence) {
            return notFound(res, "Evidence");
        }

        const caseRecord = await Case.findById(evidence.caseId).select("assignedOfficerIds");
        if (!caseRecord || !canAccessCase(req, caseRecord)) {
            return res.status(403).json({
                success: false,
                message: "You may only download evidence for assigned cases",
                error: "CASE_ACCESS_DENIED",
            });
        }

        if (!evidence.fileUrl) {
            return res.status(404).json({
                success: false,
                message: "No evidence file is attached for this record",
                error: "EVIDENCE_FILE_NOT_FOUND",
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                evidenceId: evidence.evidenceId,
                caseId: evidence.caseId,
                downloadUrl: evidence.fileUrl,
                fileUrl: evidence.fileUrl,
                type: evidence.type,
                status: evidence.status,
                verificationStatus: evidence.verificationStatus || "unverified",
            },
        });
    } catch (error) {
        return handleError(res, error, "Download evidence error");
    }
};

const getEvidenceCustodyHistory = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");
        }

        const evidence = await Evidence.findById(req.params.id).select("caseId evidenceId");
        if (!evidence) {
            return notFound(res, "Evidence");
        }

        const caseRecord = await Case.findById(evidence.caseId).select("assignedOfficerIds");
        if (!caseRecord) {
            return notFound(res, "Case");
        }
        if (!canAccessCase(req, caseRecord)) {
            return res.status(403).json({
                success: false,
                message: "You may only view custody for evidence in assigned cases",
                error: "CASE_ACCESS_DENIED",
            });
        }

        const history = await EvidenceCustodyHistory.find({ evidenceId: evidence._id })
            .sort({ timestamp: 1 })
            .lean();

        return res.status(200).json({
            success: true,
            data: history,
        });
    } catch (error) {
        return handleError(res, error, "Get evidence custody history error");
    }
};

const transferEvidenceCustody = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");
        }

        const targetOfficerId = req.body?.toOfficerId || req.body?.toCustodian || req.body?.targetOfficerId;
        if (!targetOfficerId || !isValidObjectId(targetOfficerId)) {
            return invalid(res, "A valid target officer is required", "INVALID_TARGET_OFFICER");
        }

        const evidence = await Evidence.findById(req.params.id).select("caseId currentCustodian collectedBy status evidenceId");
        if (!evidence) {
            return notFound(res, "Evidence");
        }

        const caseRecord = await Case.findById(evidence.caseId).select("assignedOfficerIds status");
        if (!caseRecord) {
            return notFound(res, "Case");
        }
        if (!canAccessCase(req, caseRecord)) {
            return res.status(403).json({
                success: false,
                message: "You may only transfer evidence for assigned cases",
                error: "CASE_ACCESS_DENIED",
            });
        }

        if (caseRecord.status === "Closed") {
            return res.status(409).json({
                success: false,
                message: "Reopen the case before transferring evidence",
                error: "CASE_CLOSED",
            });
        }

        const currentCustodianId = evidence.currentCustodian || evidence.collectedBy;
        const actorOfficerId = req.authority?.officer?._id;
        const actorRank = req.authority?.rank;
        if (!actorOfficerId) {
            return res.status(403).json({
                success: false,
                message: "A valid authenticated officer is required for custody transfer",
                error: "OFFICER_REQUIRED",
            });
        }

        const isCurrentCustodian = String(currentCustodianId) === String(actorOfficerId);
        const isSeniorOfficer = !!actorRank && ["inspector", "dsp", "sp"].includes(actorRank);
        if (!isCurrentCustodian && !isSeniorOfficer) {
            return res.status(403).json({
                success: false,
                message: "Only the current custodian or a senior officer may transfer evidence",
                error: "CUSTODY_TRANSFER_NOT_ALLOWED",
            });
        }

        const targetOfficer = await Officer.findById(targetOfficerId).populate("userId", "status isActive role");
        if (!targetOfficer) {
            return notFound(res, "Officer");
        }

        if (targetOfficer.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Target officer is not eligible to receive evidence",
                error: "TARGET_OFFICER_INELIGIBLE",
            });
        }

        if (!targetOfficer.userId || !targetOfficer.userId.isActive) {
            return res.status(403).json({
                success: false,
                message: "Target officer account is inactive",
                error: "TARGET_OFFICER_INACTIVE",
            });
        }

        if (!caseRecord.assignedOfficerIds?.some((officerId) => String(officerId) === String(targetOfficer._id))) {
            return res.status(403).json({
                success: false,
                message: "The target officer must be assigned to the same case",
                error: "TARGET_OFFICER_OUT_OF_SCOPE",
            });
        }

        if (String(targetOfficer._id) === String(currentCustodianId)) {
            return res.status(409).json({
                success: false,
                message: "Evidence is already under the target custodian",
                error: "CUSTODY_TRANSFER_REDUNDANT",
            });
        }

        const hasClientMetadataTampering =
            Object.prototype.hasOwnProperty.call(req.body, "performedBy") ||
            Object.prototype.hasOwnProperty.call(req.body, "performedByOfficer") ||
            Object.prototype.hasOwnProperty.call(req.body, "timestamp") ||
            Object.prototype.hasOwnProperty.call(req.body, "createdAt") ||
            Object.prototype.hasOwnProperty.call(req.body, "updatedAt");

        const event = await appendEvidenceCustodyEntry({
            evidenceId: evidence._id,
            caseId: evidence.caseId,
            action: "TRANSFERRED",
            fromCustodian: currentCustodianId,
            toCustodian: targetOfficer._id,
            performedBy: req.user?.userId,
            performedByOfficer: actorOfficerId,
            remarks: typeof req.body?.remarks === "string" ? req.body.remarks.trim() : undefined,
        });

        if (!event) {
            return res.status(500).json({
                success: false,
                message: "Failed to create custody history",
                error: "CUSTODY_HISTORY_CREATE_FAILED",
            });
        }

        if (hasClientMetadataTampering) {
            return res.status(200).json({
                success: true,
                message: "Evidence custody metadata was sanitized and the transfer was not applied",
                data: {
                    evidenceId: evidence._id,
                    previousCustodian: currentCustodianId,
                    currentCustodian: currentCustodianId,
                    event,
                },
            });
        }

        evidence.currentCustodian = targetOfficer._id;
        evidence.updatedBy = req.user?.userId;
        await evidence.save();

        return res.status(200).json({
            success: true,
            message: "Evidence custody transferred successfully",
            data: {
                evidenceId: evidence._id,
                previousCustodian: currentCustodianId,
                currentCustodian: targetOfficer._id,
                event,
            },
        });
    } catch (error) {
        return handleError(res, error, "Transfer evidence custody error");
    }
};

const verifyEvidence = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid evidence ID", "INVALID_EVIDENCE_ID");
        }

        const evidence = await Evidence.findById(req.params.id).select("caseId evidenceId status verificationStatus verificationNotes verifiedBy verifiedAt");
        if (!evidence) {
            return notFound(res, "Evidence");
        }

        const caseRecord = await Case.findById(evidence.caseId).select("assignedOfficerIds");
        if (!caseRecord || !canAccessCase(req, caseRecord)) {
            return res.status(403).json({
                success: false,
                message: "You may only verify evidence for assigned cases",
                error: "CASE_ACCESS_DENIED",
            });
        }

        const rank = req.authority?.rank;
        if (!rank || !["inspector", "dsp", "sp"].includes(rank)) {
            return res.status(403).json({
                success: false,
                message: "Only Inspector, DSP, and SP officers can verify evidence",
                error: "INSUFFICIENT_PERMISSIONS",
            });
        }

        const nextVerificationStatus = normalizeVerificationStatus(req.body?.verificationStatus || "verified");
        if (nextVerificationStatus === null) {
            return invalid(res, "verificationStatus must be one of: unverified, verified, rejected", "INVALID_VERIFICATION_STATUS");
        }

        const updated = await Evidence.findByIdAndUpdate(
            req.params.id,
            {
                verificationStatus: nextVerificationStatus,
                verifiedBy: req.user?.userId,
                verifiedAt: new Date(),
                verificationNotes: typeof req.body?.verificationNotes === "string" ? req.body.verificationNotes.trim() : evidence.verificationNotes || "",
                status: nextVerificationStatus === "rejected" ? evidence.status : "Verified",
            },
            { new: true, runValidators: true },
        ).select("-__v");

        await appendCaseHistory({
            caseId: evidence.caseId,
            actionType: nextVerificationStatus === "verified" ? "evidence_verified" : "evidence_verification_rejected",
            description: nextVerificationStatus === "verified" ? `Evidence verified: ${evidence.evidenceId}` : `Evidence verification rejected: ${evidence.evidenceId}`,
            performedBy: req.user?.userId,
            performedByRole: req.authority?.systemRole || req.user?.role,
            performedByRank: req.authority?.rank,
            previousValue: { verificationStatus: evidence.verificationStatus },
            newValue: { verificationStatus: nextVerificationStatus, verificationNotes: updated.verificationNotes, verifiedBy: updated.verifiedBy },
            metadata: { evidenceId: evidence.evidenceId, caseId: evidence.caseId.toString(), verificationStatus: nextVerificationStatus },
        });

        return updated
            ? res.status(200).json({
                  success: true,
                  message: nextVerificationStatus === "verified" ? "Evidence verified successfully" : "Evidence verification rejected",
                  data: updated,
              })
            : notFound(res, "Evidence");
    } catch (error) {
        return handleError(res, error, "Verify evidence error");
    }
};

module.exports = {
    createEvidence,
    getAllEvidence,
    getEvidenceById,
    updateEvidence,
    updateEvidenceStatus,
    downloadEvidence,
    verifyEvidence,
    getEvidenceCustodyHistory,
    transferEvidenceCustody,
    normalizeEvidenceStatus,
    validateEvidenceStatus,
    normalizeEvidenceType,
    validateEvidenceType,
    buildEvidenceQueryFilters,
    validateEvidence,
    normalizeVerificationStatus,
};
