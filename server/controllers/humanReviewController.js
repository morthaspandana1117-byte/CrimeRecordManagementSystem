const mongoose = require("mongoose");
const HumanReviewSuggestion = require("../models/HumanReviewSuggestion");
const HumanReviewHistory = require("../models/HumanReviewHistory");
const Case = require("../models/Case");
const { isValidObjectId, invalid, notFound, conflict, handleError } = require("./controllerUtils");
const auditService = require("../services/auditService");

const VALID_STATUSES = ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"];
const REVIEW_ACTIONS = {
    accept: "ACCEPTED",
    correct: "CORRECTED",
    reject: "REJECTED",
};

const ensureReviewPermission = (req, res, next) => {
    const role = req.authority?.systemRole || req.user?.role;
    if (!role || !["system_admin", "officer"].includes(role)) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to review AI suggestions",
            error: "INSUFFICIENT_PERMISSIONS",
        });
    }

    return next();
};

const normalizeStatus = (value) => {
    if (typeof value !== "string") return null;
    const candidate = value.trim().toUpperCase();
    return VALID_STATUSES.includes(candidate) ? candidate : null;
};

const buildQuery = (query = {}) => {
    const filter = {};
    if (query.status) {
        const status = normalizeStatus(query.status);
        if (!status) {
            throw Object.assign(new Error("Invalid status filter"), { statusCode: 400, errorCode: "INVALID_STATUS" });
        }
        filter.status = status;
    }

    if (query.caseId) {
        if (!isValidObjectId(query.caseId)) {
            throw Object.assign(new Error("Invalid caseId"), { statusCode: 400, errorCode: "INVALID_CASE_ID" });
        }
        filter.caseId = query.caseId;
    }

    if (query.suggestionType) {
        filter.suggestionType = { $regex: String(query.suggestionType).trim(), $options: "i" };
    }

    if (query.from || query.to) {
        filter.generatedAt = {};
        if (query.from) {
            const fromDate = new Date(query.from);
            if (Number.isNaN(fromDate.getTime())) {
                throw Object.assign(new Error("Invalid from date"), { statusCode: 400, errorCode: "INVALID_DATE_RANGE" });
            }
            filter.generatedAt.$gte = fromDate;
        }
        if (query.to) {
            const toDate = new Date(query.to);
            if (Number.isNaN(toDate.getTime())) {
                throw Object.assign(new Error("Invalid to date"), { statusCode: 400, errorCode: "INVALID_DATE_RANGE" });
            }
            filter.generatedAt.$lte = toDate;
        }
    }

    if (query.search || query.q) {
        const search = String(query.search || query.q).trim();
        if (search) {
            filter.$or = [
                { sourceInfo: { $regex: search, $options: "i" } },
                { originalSuggestion: { $regex: search, $options: "i" } },
                { suggestionType: { $regex: search, $options: "i" } },
                { reviewRemarks: { $regex: search, $options: "i" } },
            ];
        }
    }

    return filter;
};

const logHumanReviewAudit = async ({ actor, action, entityId, before, after, method, path }) => {
    try {
        await auditService.log({
            actor,
            action,
            entityType: "HumanReviewSuggestion",
            entityId,
            before,
            after,
            method,
            path,
        });
    } catch (error) {
        console.error("Human review audit logging failed:", error);
        throw error;
    }
};

const getAllSuggestions = async (req, res) => {
    try {
        const page = Number.parseInt(req.query.page || "1", 10);
        const limit = Number.parseInt(req.query.limit || "20", 10);

        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return invalid(res, "Page must be a positive integer and limit must be between 1 and 100", "INVALID_PAGINATION");
        }

        const filter = buildQuery(req.query);
        const [data, totalRecords] = await Promise.all([
            HumanReviewSuggestion.find(filter)
                .populate("reviewedBy", "username email role")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            HumanReviewSuggestion.countDocuments(filter),
        ]);

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
            },
        });
    } catch (error) {
        if (error?.statusCode === 400) {
            return invalid(res, error.message, error.errorCode || "INVALID_QUERY");
        }
        return handleError(res, error, "Get human review suggestions error");
    }
};

const getSuggestionDetail = async (req, res) => {
    try {
        const suggestionId = req.params.id;
        if (!isValidObjectId(suggestionId)) {
            return invalid(res, "Suggestion ID must be a valid ObjectId", "INVALID_SUGGESTION_ID");
        }

        const suggestion = await HumanReviewSuggestion.findById(suggestionId)
            .populate("reviewedBy", "username email role")
            .lean();

        if (!suggestion) {
            return notFound(res, "Suggestion");
        }

        const history = await HumanReviewHistory.find({ suggestionId: suggestion._id })
            .populate("reviewerId", "username email role")
            .sort({ createdAt: 1 })
            .lean();

        return res.status(200).json({
            success: true,
            data: {
                ...suggestion,
                reviewHistory: history,
            },
        });
    } catch (error) {
        return handleError(res, error, "Get human review detail error");
    }
};

const getSuggestionHistory = async (req, res) => {
    try {
        const filter = {};
        const suggestionIdParam = req.params?.id || req.query.suggestionId;
        if (suggestionIdParam) {
            if (!isValidObjectId(suggestionIdParam)) {
                return invalid(res, "Suggestion ID must be a valid ObjectId", "INVALID_SUGGESTION_ID");
            }
            filter.suggestionId = suggestionIdParam;
        }

        const history = await HumanReviewHistory.find(filter)
            .populate("reviewerId", "username email role")
            .sort({ createdAt: 1 })
            .lean();

        return res.status(200).json({ success: true, data: history });
    } catch (error) {
        return handleError(res, error, "Get human review history error");
    }
};

const createSuggestion = async (req, res) => {
    try {
        const {
            caseId,
            suggestionType,
            relatedRecordId,
            relatedRecordType,
            sourceInfo,
            originalSuggestion,
            aiModel,
            generatedAt,
        } = req.body;

        if (!caseId || !isValidObjectId(caseId)) {
            return invalid(res, "A valid caseId is required", "INVALID_CASE_ID");
        }

        const caseExists = await Case.exists({ _id: caseId });
        if (!caseExists) {
            return notFound(res, "Case");
        }

        if (typeof suggestionType !== "string" || !suggestionType.trim()) {
            return invalid(res, "suggestionType is required", "INVALID_SUGGESTION_TYPE");
        }

        if (typeof sourceInfo !== "string" || !sourceInfo.trim()) {
            return invalid(res, "sourceInfo is required", "INVALID_SOURCE_INFO");
        }

        if (typeof originalSuggestion !== "string" || !originalSuggestion.trim()) {
            return invalid(res, "originalSuggestion is required", "INVALID_ORIGINAL_SUGGESTION");
        }

        if (relatedRecordId && !isValidObjectId(relatedRecordId)) {
            return invalid(res, "relatedRecordId must be a valid ObjectId", "INVALID_RELATED_RECORD_ID");
        }

        const createdSuggestion = await HumanReviewSuggestion.create({
            caseId,
            suggestionType: suggestionType.trim(),
            relatedRecordId: relatedRecordId || null,
            relatedRecordType: relatedRecordType || null,
            sourceInfo: sourceInfo.trim(),
            originalSuggestion: originalSuggestion.trim(),
            aiModel: aiModel ? String(aiModel).trim() : null,
            generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
            status: "PENDING",
        });

        await HumanReviewHistory.create({
            suggestionId: createdSuggestion._id,
            previousStatus: "PENDING",
            newStatus: "PENDING",
            reviewerId: null,
            reviewerRole: null,
            previousContent: null,
            updatedContent: null,
            reviewComments: "Suggestion created",
            actionPerformed: "CREATED",
        });

        await logHumanReviewAudit({
            actor: req.user?.userId || null,
            action: "HUMAN_REVIEW_CREATED",
            entityId: createdSuggestion._id,
            before: null,
            after: {
                status: createdSuggestion.status,
                suggestionType: createdSuggestion.suggestionType,
                caseId: createdSuggestion.caseId,
            },
            method: req.method,
            path: req.originalUrl,
        });

        return res.status(201).json({
            success: true,
            message: "AI suggestion created successfully",
            data: createdSuggestion,
        });
    } catch (error) {
        if (error?.code === 11000) {
            return conflict(res, "A suggestion with the same primary key already exists", "DUPLICATE_SUGGESTION");
        }
        return handleError(res, error, "Create human review suggestion error");
    }
};

const applyReviewAction = async (req, res, action) => {
    try {
        const suggestionId = req.params.id;
        if (!isValidObjectId(suggestionId)) {
            return invalid(res, "Suggestion ID must be a valid ObjectId", "INVALID_SUGGESTION_ID");
        }

        const suggestion = await HumanReviewSuggestion.findById(suggestionId);
        if (!suggestion) {
            return notFound(res, "Suggestion");
        }

        if (suggestion.status !== "PENDING") {
            return conflict(res, `Suggestion is already in ${suggestion.status} status and cannot be changed again`, "DUPLICATE_REVIEW_ACTION");
        }

        const reviewerId = req.user?.userId;
        const reviewerRole = req.authority?.systemRole || req.user?.role || "officer";
        const notes = typeof req.body.comments === "string" ? req.body.comments.trim() : (typeof req.body.reason === "string" ? req.body.reason.trim() : "");

        if (action === "correct") {
            if (typeof req.body.correctedSuggestion !== "string" || !req.body.correctedSuggestion.trim()) {
                return invalid(res, "correctedSuggestion is required", "INVALID_CORRECTED_SUGGESTION");
            }
            if (!notes) {
                return invalid(res, "review explanation is required", "INVALID_REVIEW_COMMENT");
            }
            suggestion.correctedSuggestion = req.body.correctedSuggestion.trim();
            suggestion.reviewRemarks = notes;
        } else if (action === "reject") {
            if (!notes) {
                return invalid(res, "rejection reason is required", "INVALID_REJECTION_REASON");
            }
            suggestion.reviewRemarks = notes;
        } else {
            suggestion.reviewRemarks = notes || suggestion.reviewRemarks || "Accepted by reviewer";
        }

        suggestion.status = REVIEW_ACTIONS[action];
        suggestion.reviewedBy = reviewerId;
        suggestion.reviewedAt = new Date();
        await suggestion.save();

        const previousContent = action === "correct" ? suggestion.originalSuggestion : suggestion.originalSuggestion;
        const updatedContent = action === "correct" ? suggestion.correctedSuggestion : suggestion.originalSuggestion;

        await HumanReviewHistory.create({
            suggestionId: suggestion._id,
            previousStatus: "PENDING",
            newStatus: suggestion.status,
            reviewerId,
            reviewerRole,
            previousContent,
            updatedContent,
            reviewComments: notes || suggestion.reviewRemarks,
            actionPerformed: action.toUpperCase(),
        });

        await logHumanReviewAudit({
            actor: reviewerId,
            action: `HUMAN_REVIEW_${action.toUpperCase()}`,
            entityId: suggestion._id,
            before: { status: "PENDING" },
            after: { status: suggestion.status, reviewedBy: reviewerId, reviewedAt: suggestion.reviewedAt },
            method: req.method,
            path: req.originalUrl,
        });

        return res.status(200).json({
            success: true,
            message: `Suggestion ${action.toLowerCase()}ed successfully`,
            data: suggestion,
        });
    } catch (error) {
        return handleError(res, error, `Review suggestion ${action} error`);
    }
};

const acceptSuggestion = (req, res) => applyReviewAction(req, res, "accept");
const rejectSuggestion = (req, res) => applyReviewAction(req, res, "reject");
const correctSuggestion = (req, res) => applyReviewAction(req, res, "correct");

module.exports = {
    ensureReviewPermission,
    getAllSuggestions,
    getSuggestionDetail,
    getSuggestionHistory,
    createSuggestion,
    acceptSuggestion,
    correctSuggestion,
    rejectSuggestion,
};
