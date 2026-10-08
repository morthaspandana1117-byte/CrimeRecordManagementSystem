const { handleError, invalid } = require("./controllerUtils");
const {
    ReportDataError,
    getCrimeStatisticsData,
    getMonthlyReportData,
    getOfficerPerformanceData,
} = require("../services/reportDataService");
const {
    createExcelBuffer,
    sectionsForReport,
    filtersForReport,
    filenameForReport,
} = require("../services/excelReportService");

const dataBuilders = {
    "crime-statistics": getCrimeStatisticsData,
    monthly: getMonthlyReportData,
    "officer-performance": getOfficerPerformanceData,
};

const hasRequestBody = (req) => req.body !== undefined
    || Number(req.get("content-length")) > 0
    || Boolean(req.get("transfer-encoding"));

const exportReportExcel = async (req, res) => {
    try {
        if (hasRequestBody(req)) {
            return invalid(res, "Excel report content is generated from authorized server data", "CLIENT_REPORT_DATA_NOT_ALLOWED");
        }
        const type = req.query.type;
        if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(dataBuilders, type)) {
            return invalid(res, "type must be crime-statistics, monthly, or officer-performance", "INVALID_REPORT_TYPE");
        }
        const query = { ...req.query };
        delete query.type;
        const data = await dataBuilders[type](query, req.authority);
        const titles = {
            "crime-statistics": "Crime Statistics Report",
            monthly: "Monthly Report",
            "officer-performance": "Officer Performance Report",
        };
        const buffer = await createExcelBuffer({
            title: titles[type],
            reportType: type,
            generatedAt: new Date(),
            filters: filtersForReport(type, query),
            sections: sectionsForReport(type, data),
        });
        const filename = filenameForReport(type, data);
        return res.status(200)
            .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .set("Content-Disposition", `attachment; filename="${filename}"`)
            .set("Cache-Control", "no-store")
            .set("Content-Length", String(buffer.length))
            .send(buffer);
    } catch (error) {
        if (error instanceof ReportDataError) {
            return res.status(error.status).json({ success: false, message: error.message, error: error.code });
        }
        return handleError(res, error, "Excel report export error");
    }
};

module.exports = { exportReportExcel };
