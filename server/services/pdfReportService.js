const { PDFDocument } = require("pdfkit");

const safeText = (value) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 240);

const addPageIfNeeded = (doc, requiredHeight = 30) => {
    if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom - 18) doc.addPage();
};

const addSection = (doc, title, rows) => {
    addPageIfNeeded(doc, 42);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#17324d").text(safeText(title));
    doc.moveDown(0.25);
    if (!rows.length) {
        doc.font("Helvetica").fontSize(10).fillColor("#333333").text("No records matched this section.");
        return;
    }
    for (const row of rows) {
        const label = safeText(row.label);
        const value = safeText(row.value);
        const line = `${label}: ${value}`;
        const height = doc.heightOfString(line, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
        addPageIfNeeded(doc, height + 5);
        doc.font("Helvetica").fontSize(10).fillColor("#333333").text(line, { paragraphGap: 3 });
    }
};

const createPdfBuffer = ({ title, reportType, filters = [], sections, generatedAt = new Date() }) => new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: "A4",
        margins: { top: 48, right: 52, bottom: 52, left: 52 },
        bufferPages: true,
        compress: false,
        info: { Title: safeText(title), Subject: safeText(reportType), Creator: "CRMS Reports" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));

    doc.font("Helvetica-Bold").fontSize(21).fillColor("#17324d").text(safeText(title));
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(9).fillColor("#555555")
        .text(`Report type: ${safeText(reportType)}`)
        .text(`Generated: ${generatedAt.toISOString()}`);
    if (filters.length) {
        doc.moveDown(0.35);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#333333").text("Filters");
        for (const filter of filters) {
            doc.font("Helvetica").fontSize(9).text(`${safeText(filter.label)}: ${safeText(filter.value)}`);
        }
    }

    for (const section of sections) addSection(doc, section.title, section.rows);

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page += 1) {
        doc.switchToPage(page);
        doc.font("Helvetica").fontSize(8).fillColor("#777777")
            .text(`Page ${page - pages.start + 1} of ${pages.count}`, 52, doc.page.height - 34, {
                width: doc.page.width - 104,
                align: "center",
                lineBreak: false,
            });
    }
    doc.end();
});

const countRows = (items, labelField) => items.map((item) => ({
    label: item[labelField],
    value: item.count,
}));

const sectionsForReport = (type, data) => {
    if (type === "crime-statistics") {
        return [
            { title: "Summary", rows: [{ label: "Total FIRs", value: data.totalFirs }] },
            { title: "Crime types", rows: countRows(data.crimeTypeStats, "crimeType") },
            { title: "FIR statuses", rows: countRows(data.statusStats, "status") },
            { title: "Locations", rows: data.locationStats.map((item) => ({ label: `${item.city}, ${item.state}`, value: item.count })) },
            { title: "Daily FIR counts (UTC)", rows: countRows(data.dateStats, "date") },
        ];
    }
    if (type === "monthly") {
        return [{
            title: "Monthly totals",
            rows: [
                { label: "FIRs", value: data.statistics.firs },
                { label: "Cases", value: data.statistics.cases },
                { label: "Evidence records", value: data.statistics.evidence },
                { label: "Reports", value: data.statistics.reports },
            ],
        }];
    }
    return [
        {
            title: "Officer",
            rows: [
                { label: "Officer ID", value: data.officer.officerId },
                { label: "Name", value: data.officer.name },
                { label: "Rank", value: data.officer.rank },
                { label: "Department", value: data.officer.department },
                { label: "Station", value: data.officer.station },
            ],
        },
        {
            title: "Objective performance metrics (all time)",
            rows: [
                { label: "FIRs registered", value: data.metrics.firsRegistered },
                { label: "Currently assigned cases", value: data.metrics.currentlyAssignedCases },
                { label: "Distinct cases with a recorded closure by this officer", value: data.metrics.distinctCasesClosedByOfficer },
                { label: "Evidence for currently assigned cases", value: data.metrics.evidenceForAssignedCases },
                { label: "Reports prepared", value: data.metrics.reportsPrepared },
            ],
        },
    ];
};

const filtersForReport = (type, query) => {
    const labels = {
        fromDate: "From date (inclusive, UTC)",
        toDate: "To date (inclusive, UTC)",
        crimeType: "Crime type",
        status: "FIR status",
        city: "City",
        state: "State",
        pincode: "Pincode",
    };
    if (type === "monthly") return [{ label: "Calendar month (UTC)", value: query.month }];
    if (type === "officer-performance") return [];
    return Object.entries(query).map(([key, value]) => ({ label: labels[key], value }));
};

const filenameForReport = (type, data) => {
    if (type === "monthly") return `monthly-report-${data.month}.pdf`;
    if (type === "officer-performance") return "officer-performance-report.pdf";
    return "crime-statistics-report.pdf";
};

module.exports = { createPdfBuffer, sectionsForReport, filtersForReport, filenameForReport };
