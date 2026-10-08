const { handleError } = require("./controllerUtils");
const { ReportDataError, getCrimeStatisticsData } = require("../services/reportDataService");

const getCrimeStatistics = async (req, res) => {
    try {
        const data = await getCrimeStatisticsData(req.query, req.authority);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        if (error instanceof ReportDataError) {
            return res.status(error.status).json({ success: false, message: error.message, error: error.code });
        }
        return handleError(res, error, "Crime statistics error");
    }
};

module.exports = { getCrimeStatistics };
