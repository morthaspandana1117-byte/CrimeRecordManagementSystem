const Report = require("../models/Report");
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
const fields = [
    "reportId",
    "caseId",
    "preparedBy",
    "reportType",
    "title",
    "content",
    "reportDate",
    "fileUrl",
    "status",
];
const required = [
    "reportId",
    "caseId",
    "preparedBy",
    "reportType",
    "title",
    "content",
    "reportDate",
    "status",
];
const populate = (query) =>
    query
        .populate("caseId", "caseNo title status")
        .populate(
            "preparedBy",
            "officerId name rank department station status",
        );
const validate = async (res, body, partial = false) => {
    if (
        !partial &&
        required.some(
            (f) => body[f] === undefined || body[f] === null || body[f] === "",
        )
    )
        return "All required report fields must be provided";
    if ((!partial || body.title !== undefined) && !isNonEmptyString(body.title))
        return "title must not be empty";
    if (
        (!partial || body.content !== undefined) &&
        !isNonEmptyString(body.content)
    )
        return "content must not be empty";
    if (
        (!partial || body.reportDate !== undefined) &&
        !isValidDate(body.reportDate)
    )
        return "reportDate must be a valid date";
    if (
        body.caseId !== undefined &&
        !(await validateReference(res, Case, body.caseId, "caseId"))
    )
        return null;
    if (
        body.preparedBy !== undefined &&
        !(await validateReference(res, Officer, body.preparedBy, "preparedBy"))
    )
        return null;
    return "OK";
};
const createReport = async (req, res) => {
    try {
        const result = await validate(res, req.body);
        if (result !== "OK") return result ? invalid(res, result) : undefined;
        const record = await Report.create(req.body);
        await record.populate([
            { path: "caseId", select: "caseNo title status" },
            {
                path: "preparedBy",
                select: "officerId name rank department station status",
            },
        ]);
        return res
            .status(201)
            .json({
                success: true,
                message: "Report created successfully",
                data: record,
            });
    } catch (error) {
        return handleError(res, error, "Create report error");
    }
};
const getAllReports = async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.caseId) {
            if (!isValidObjectId(req.query.caseId))
                return invalid(res, "Invalid case ID", "INVALID_CASE_ID");
            filter.caseId = req.query.caseId;
        }
        const records = await populate(
            Report.find(filter).select("-__v").sort({ reportDate: -1 }),
        );
        return res
            .status(200)
            .json({ success: true, count: records.length, data: records });
    } catch (error) {
        return handleError(res, error, "Get reports error");
    }
};
const getReportById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid report ID", "INVALID_REPORT_ID");
        const record = await populate(
            Report.findById(req.params.id).select("-__v"),
        );
        return record
            ? res.status(200).json({ success: true, data: record })
            : notFound(res, "Report");
    } catch (error) {
        return handleError(res, error, "Get report error");
    }
};
const updateReport = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid report ID", "INVALID_REPORT_ID");
        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) => fields.includes(key)),
        );
        if (!Object.keys(updates).length)
            return invalid(res, "No valid report fields were provided");
        const result = await validate(res, updates, true);
        if (result !== "OK") return result ? invalid(res, result) : undefined;
        const record = await populate(
            Report.findByIdAndUpdate(req.params.id, updates, {
                new: true,
                runValidators: true,
            }).select("-__v"),
        );
        return record
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "Report updated successfully",
                      data: record,
                  })
            : notFound(res, "Report");
    } catch (error) {
        return handleError(res, error, "Update report error");
    }
};
const deleteReport = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid report ID", "INVALID_REPORT_ID");
        const record = await Report.findByIdAndDelete(req.params.id);
        return record
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "Report deleted successfully",
                      data: { id: record._id },
                  })
            : notFound(res, "Report");
    } catch (error) {
        return handleError(res, error, "Delete report error");
    }
};
module.exports = {
    createReport,
    getAllReports,
    getReportById,
    updateReport,
    deleteReport,
};
