const { isValidObjectId, invalid, notFound, handleError } = require("./controllerUtils");
const aiEvaluationService = require("../services/aiEvaluationService");

const buildFilter = (query = {}) => {
    const filter = {};

    if (query.category) {
        filter.category = String(query.category).trim();
    }

    if (query.status) {
        const status = String(query.status).trim().toUpperCase();
        if (!["PASS", "FAIL"].includes(status)) {
            throw Object.assign(new Error("Invalid status filter"), { statusCode: 400, errorCode: "INVALID_STATUS" });
        }
        filter.status = status;
    }

    if (query.severity) {
        const severity = String(query.severity).trim().toUpperCase();
        if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
            throw Object.assign(new Error("Invalid severity filter"), { statusCode: 400, errorCode: "INVALID_SEVERITY" });
        }
        filter.severity = severity;
    }

    const dateValue = query.date || query.day;
    if (dateValue) {
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) {
            throw Object.assign(new Error("Invalid date filter"), { statusCode: 400, errorCode: "INVALID_DATE_FILTER" });
        }
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        filter.executedAt = { $gte: start, $lte: end };
    }

    if (query.search || query.q) {
        const search = String(query.search || query.q).trim();
        if (search) {
            filter.$or = [
                { testCaseId: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } },
            ];
        }
    }

    if (query.from || query.to) {
        filter.executedAt = {};
        if (query.from) {
            const from = new Date(query.from);
            if (Number.isNaN(from.getTime())) {
                throw Object.assign(new Error("Invalid from date"), { statusCode: 400, errorCode: "INVALID_DATE_RANGE" });
            }
            filter.executedAt.$gte = from;
        }
        if (query.to) {
            const to = new Date(query.to);
            if (Number.isNaN(to.getTime())) {
                throw Object.assign(new Error("Invalid to date"), { statusCode: 400, errorCode: "INVALID_DATE_RANGE" });
            }
            filter.executedAt.$lte = to;
        }
    }

    return filter;
};

const runEvaluation = async (req, res) => {
    try {
        const result = await aiEvaluationService.runEvaluation({ executedBy: req.user?.userId || req.user?._id || null });
        return res.status(200).json({
            success: true,
            message: "AI evaluation completed successfully",
            data: result.data,
            summary: result.summary,
        });
    } catch (error) {
        if (error?.statusCode === 409) {
            return res.status(409).json({
                success: false,
                message: "Evaluation is already running",
                error: "EVALUATION_IN_PROGRESS",
            });
        }
        return handleError(res, error, "AI evaluation run error");
    }
};

const listResults = async (req, res) => {
    try {
        const page = Number.parseInt(req.query.page || "1", 10);
        const limit = Number.parseInt(req.query.limit || "20", 10);

        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return invalid(res, "page must be a positive integer and limit must be between 1 and 100", "INVALID_PAGINATION");
        }

        const filter = buildFilter(req.query);
        const result = await aiEvaluationService.getResults({ filter, page, limit });
        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination,
        });
    } catch (error) {
        if (error?.statusCode === 400) {
            return invalid(res, error.message, error.errorCode || "INVALID_FILTER");
        }
        return handleError(res, error, "Get AI evaluation results error");
    }
};

const getResultById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return invalid(res, "Result ID must be a valid ObjectId", "INVALID_RESULT_ID");
        const result = await aiEvaluationService.getResultById(id);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (error?.statusCode === 404) {
            return notFound(res, "Evaluation result");
        }
        if (error?.statusCode === 400) {
            return invalid(res, error.message, error.errorCode || "INVALID_RESULT_ID");
        }
        return handleError(res, error, "Get AI evaluation result error");
    }
};

const getSummary = async (req, res) => {
    try {
        const filter = buildFilter(req.query);
        const summary = await aiEvaluationService.getSummary(filter);
        return res.status(200).json({ success: true, data: summary });
    } catch (error) {
        if (error?.statusCode === 400) {
            return invalid(res, error.message, error.errorCode || "INVALID_FILTER");
        }
        return handleError(res, error, "Get AI evaluation summary error");
    }
};

const getHealth = async (req, res) => {
    try {
        const health = aiEvaluationService.getHealth();
        return res.status(200).json({ success: true, data: health });
    } catch (error) {
        return handleError(res, error, "Get AI evaluation health error");
    }
};

module.exports = {
    runEvaluation,
    listResults,
    getResultById,
    getSummary,
    getHealth,
};
