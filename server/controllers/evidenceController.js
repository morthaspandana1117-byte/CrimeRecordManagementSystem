const Evidence = require("../models/Evidence");
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
        const payload = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );

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

        const normalizedStatus = normalizeEvidenceStatus(req.body.status);
        if (normalizedStatus === null) {
            return invalid(
                res,
                "status must be one of: Collected, Under Examination, Verified, Stored, Released, Disposed",
                "INVALID_EVIDENCE_STATUS",
            );
        }

        const currentRecord = await Evidence.findById(req.params.id).select("status evidenceId caseId");
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
    normalizeEvidenceStatus,
    validateEvidenceStatus,
    normalizeEvidenceType,
    validateEvidenceType,
    buildEvidenceQueryFilters,
    validateEvidence,
    normalizeVerificationStatus,
};
