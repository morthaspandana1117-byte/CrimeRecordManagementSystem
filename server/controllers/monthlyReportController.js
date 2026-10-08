const { handleError } = require("./controllerUtils");
const { ReportDataError, getMonthlyReportData } = require("../services/reportDataService");

const getMonthlyReport = async (req, res) => {
    try {
        const data = await getMonthlyReportData(req.query, req.authority);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error instanceof ReportDataError) {
            return res.status(error.status).json({ success: false, message: error.message, error: error.code });
        }
        return handleError(res, error, "Monthly report error");
    }
};

module.exports = { getMonthlyReport };
