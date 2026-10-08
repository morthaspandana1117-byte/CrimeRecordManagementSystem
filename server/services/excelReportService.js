const ExcelJS = require("exceljs");

const textValue = (value) => {
    let text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return text;
};

const addRow = (sheet, label, value) => {
    const row = sheet.addRow([textValue(label), typeof value === "number" ? value : textValue(value)]);
    row.getCell(1).numFmt = "@";
    if (typeof value !== "number") row.getCell(2).numFmt = "@";
    return row;
};

const addSection = (sheet, title, rows) => {
    sheet.addRow([]);
    const heading = sheet.addRow([textValue(title)]);
    heading.font = { bold: true, color: { argb: "FF17324D" } };
    sheet.addRow(["Metric", "Value"]).font = { bold: true };
    if (!rows.length) {
        addRow(sheet, "Result", "No records matched this section.");
        return;
    }
    for (const row of rows) addRow(sheet, row.label, row.value);
};

const createExcelBuffer = async ({ title, reportType, generatedAt = new Date(), filters = [], sections }) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CRMS Reports";
    workbook.created = generatedAt;
    const sheet = workbook.addWorksheet("Report");
    sheet.columns = [{ width: 44 }, { width: 48 }];
    sheet.addRow([textValue(title)]).font = { bold: true, size: 16, color: { argb: "FF17324D" } };
    addRow(sheet, "Report type", reportType);
    addRow(sheet, "Generated", generatedAt.toISOString());
    if (filters.length) {
        addSection(sheet, "Applied filters", filters.map((filter) => ({ label: filter.label, value: filter.value })));
    }
    for (const section of sections) addSection(sheet, section.title, section.rows);
    return workbook.xlsx.writeBuffer();
};

const countRows = (items, labelField) => items.map((item) => ({ label: item[labelField], value: item.count }));

const sectionsForReport = (type, data) => {
    if (type === "crime-statistics") {
        return [
            { title: "Summary", rows: [{ label: "Total FIRs", value: data.totalFirs }] },
            { title: "Crime type statistics", rows: countRows(data.crimeTypeStats, "crimeType") },
            { title: "Status statistics", rows: countRows(data.statusStats, "status") },
            { title: "Location statistics", rows: data.locationStats.map((item) => ({ label: `${item.city}, ${item.state}`, value: item.count })) },
            { title: "Daily statistics (UTC)", rows: countRows(data.dateStats, "date") },
        ];
    }
    if (type === "monthly") {
        return [{ title: `Monthly totals: ${data.month} (UTC)`, rows: [
            { label: "FIRs", value: data.statistics.firs },
            { label: "Cases", value: data.statistics.cases },
            { label: "Evidence records", value: data.statistics.evidence },
            { label: "Reports", value: data.statistics.reports },
        ] }];
    }
    return [
        { title: "Officer", rows: [
            { label: "Officer ID", value: data.officer.officerId },
            { label: "Name", value: data.officer.name },
        ] },
        { title: "Objective performance metrics (all time)", rows: [
            { label: "FIRs registered", value: data.metrics.firsRegistered },
            { label: "Currently assigned cases", value: data.metrics.currentlyAssignedCases },
            { label: "Distinct cases closed by officer", value: data.metrics.distinctCasesClosedByOfficer },
            { label: "Evidence for assigned cases", value: data.metrics.evidenceForAssignedCases },
            { label: "Reports prepared", value: data.metrics.reportsPrepared },
        ] },
    ];
};

const filtersForReport = (type, query) => {
    if (type === "monthly") return [{ label: "Calendar month (UTC)", value: query.month }];
    if (type === "officer-performance") return [];
    const labels = {
        fromDate: "From date (inclusive, UTC)", toDate: "To date (inclusive, UTC)",
        crimeType: "Crime type", status: "FIR status", city: "City", state: "State", pincode: "Pincode",
    };
    return Object.entries(query).map(([key, value]) => ({ label: labels[key], value }));
};

const filenameForReport = (type, data) => type === "monthly"
    ? `monthly-report-${data.month}.xlsx`
    : type === "officer-performance" ? "officer-performance-report.xlsx" : "crime-statistics-report.xlsx";

module.exports = { createExcelBuffer, sectionsForReport, filtersForReport, filenameForReport, textValue };
