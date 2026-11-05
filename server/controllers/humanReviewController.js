const HumanReviewSuggestion = require("../models/HumanReviewSuggestion");
const HumanReviewHistory = require("../models/HumanReviewHistory");
const { isValidObjectId, handleError, invalid, notFound } = require("./controllerUtils");

const getAllSuggestions = async (req, res) => {
    try {
        const suggestions = await HumanReviewSuggestion.find().sort({ createdAt: -1 }).lean();
        return res.status(200).json({ success: true, data: suggestions });
    } catch (error) {
        return handleError(res, error, "Get human review suggestions error");
    }
};

const getSuggestionDetail = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return invalid(res, "Suggestion ID must be a valid ObjectId", "INVALID_SUGGESTION_ID");
        const suggestion = await HumanReviewSuggestion.findById(id).lean();
        if (!suggestion) return notFound(res, "Suggestion");
        const history = await HumanReviewHistory.find({ suggestionId: id }).sort({ createdAt: 1 }).lean();
        return res.status(200).json({ success: true, data: { ...suggestion, reviewHistory: history } });
    } catch (error) {
        return handleError(res, error, "Get human review detail error");
    }
};

const createSuggestion = async (req, res) => {
    try {
        const suggestion = await HumanReviewSuggestion.create({
            caseId: req.body.caseId,
            suggestionType: req.body.suggestionType,
            sourceInfo: req.body.sourceInfo,
            originalSuggestion: req.body.originalSuggestion,
            correctedSuggestion: req.body.correctedSuggestion || null,
            status: "PENDING",
        });
        return res.status(201).json({ success: true, data: suggestion });
    } catch (error) {
        return handleError(res, error, "Create human review suggestion error");
    }
};

const acceptSuggestion = async (req, res) => {
    try {
        const suggestion = await HumanReviewSuggestion.findById(req.params.id);
        if (!suggestion) return notFound(res, "Suggestion");
        suggestion.status = "ACCEPTED";
        suggestion.reviewedBy = req.user?.userId;
        suggestion.reviewedAt = new Date();
        suggestion.reviewRemarks = req.body?.comments || suggestion.reviewRemarks || "Accepted by reviewer";
        await suggestion.save();
        await HumanReviewHistory.create({
            suggestionId: suggestion._id,
            previousStatus: "PENDING",
            newStatus: "ACCEPTED",
            reviewerId: req.user?.userId,
            reviewerRole: req.authority?.systemRole || req.user?.role,
            reviewComments: suggestion.reviewRemarks,
            actionPerformed: "ACCEPTED",
        });
        return res.status(200).json({ success: true, data: suggestion });
    } catch (error) {
        return handleError(res, error, "Accept suggestion error");
    }
};

const correctSuggestion = async (req, res) => {
    try {
        const suggestion = await HumanReviewSuggestion.findById(req.params.id);
        if (!suggestion) return notFound(res, "Suggestion");
        suggestion.status = "CORRECTED";
        suggestion.correctedSuggestion = req.body.correctedSuggestion;
        suggestion.reviewedBy = req.user?.userId;
        suggestion.reviewedAt = new Date();
        suggestion.reviewRemarks = req.body.comments || "Corrected by reviewer";
        await suggestion.save();
        await HumanReviewHistory.create({
            suggestionId: suggestion._id,
            previousStatus: "PENDING",
            newStatus: "CORRECTED",
            reviewerId: req.user?.userId,
            reviewerRole: req.authority?.systemRole || req.user?.role,
            reviewComments: suggestion.reviewRemarks,
            actionPerformed: "CORRECTED",
        });
        return res.status(200).json({ success: true, data: suggestion });
    } catch (error) {
        return handleError(res, error, "Correct suggestion error");
    }
};

const rejectSuggestion = async (req, res) => {
    try {
        const suggestion = await HumanReviewSuggestion.findById(req.params.id);
        if (!suggestion) return notFound(res, "Suggestion");
        suggestion.status = "REJECTED";
        suggestion.reviewedBy = req.user?.userId;
        suggestion.reviewedAt = new Date();
        suggestion.reviewRemarks = req.body.reason || "Rejected by reviewer";
        await suggestion.save();
        await HumanReviewHistory.create({
            suggestionId: suggestion._id,
            previousStatus: "PENDING",
            newStatus: "REJECTED",
            reviewerId: req.user?.userId,
            reviewerRole: req.authority?.systemRole || req.user?.role,
            reviewComments: suggestion.reviewRemarks,
            actionPerformed: "REJECTED",
        });
        return res.status(200).json({ success: true, data: suggestion });
    } catch (error) {
        return handleError(res, error, "Reject suggestion error");
    }
};

module.exports = {
    getAllSuggestions,
    getSuggestionDetail,
    createSuggestion,
    acceptSuggestion,
    correctSuggestion,
    rejectSuggestion,
};
