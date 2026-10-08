const { handleError } = require("./controllerUtils");
const { ReportDataError, getOfficerPerformanceData } = require("../services/reportDataService");

const getOfficerPerformance = async (req, res) => {
    try {
        const data = await getOfficerPerformanceData(req.query, req.authority);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error instanceof ReportDataError) {
            return res.status(error.status).json({ success: false, message: error.message, error: error.code });
        }
        return handleError(res, error, "Officer performance report error");
    }
};

module.exports = { getOfficerPerformance };
