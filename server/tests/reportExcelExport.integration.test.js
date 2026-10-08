const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const ExcelJS = require("exceljs");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "report-excel-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const CaseHistory = require("../models/CaseHistory");
const Evidence = require("../models/Evidence");
const Report = require("../models/Report");

let mongoServer;
let app;
const users = {};
const officers = {};
const tokens = {};
const password = "ReportExcel@123";

const parseBuffer = (response, callback) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (/application\/json/i.test(response.headers["content-type"] || "")) {
            try { callback(null, JSON.parse(buffer.toString("utf8"))); }
            catch (error) { callback(error); }
            return;
        }
        callback(null, buffer);
    });
    response.on("error", callback);
};

const excelRequest = (type, query = {}) => request(app)
    .get("/api/reports/export/excel")
    .query({ type, ...query })
    .set("Authorization", `Bearer ${tokens.juniorA}`)
    .buffer(true)
    .parse(parseBuffer);

const workbookFrom = async (response) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    return workbook;
};

const sheetText = (sheet) => sheet.getSheetValues().flat().filter((value) => value !== undefined).join("\n");

const createOfficer = async (key, rank, name = `excel-${key}`) => {
    const username = `excel-${key}`;
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        passwordResetToken: `secret-reset-${key}`,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    users[key] = user;
    officers[key] = await Officer.create({
        userId: user._id,
        officerId: `EX-${key}`,
        badgeNumber: `EX${key.replace(/[^a-z0-9]/gi, "").slice(-4).padStart(4, "0").toUpperCase()}`,
        name,
        rank,
        department: "Criminal Investigation",
        station: "Excel Station",
        phoneNumber: "5550501000",
        address: "Excel Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createFIR = (key, registeredBy, date, crimeType = "Theft", city = "Bengaluru") => FIR.create({
    firNo: `EX-FIR-${key}`,
    date,
    policeStation: "Excel Station",
    complaint: { complainantName: "Test Complainant", complaintText: "Test complaint" },
    description: "Excel report fixture",
    crimeType,
    location: { address: "1 Test Road", city, state: "Karnataka", pincode: "560001" },
    registeredBy,
    criminalIds: [],
    status: "Open",
});

const createCase = (key, firId, assignedOfficerIds, startDate) => Case.create({
    caseNo: `EX-CASE-${key}`,
    firId,
    assignedOfficerIds,
    criminalIds: [],
    title: `Excel case ${key}`,
    description: "Excel report fixture",
    startDate,
    status: "Open",
    priority: "Medium",
});

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-report-excel"));
    app = createApp();

    await createOfficer("junior-a", "constable", "=HYPERLINK(\"https://example.test\")");
    await createOfficer("junior-b", "constable");
    await createOfficer("inspector", "inspector");
    await createOfficer("inspector-peer", "inspector");
    await createOfficer("dsp", "dsp");
    users.admin = await User.create({
        username: "excel-system-admin",
        email: "excel-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });

    tokens.juniorA = await login("excel-junior-a");
    tokens.inspector = await login("excel-inspector");
    tokens.admin = await login("excel-system-admin");

    const firAFirst = await createFIR("a-first", officers["junior-a"]._id, "2026-09-01T00:00:00.000Z", "Theft");
    const firOther = await createFIR("b-middle", officers["junior-b"]._id, "2026-09-15T12:00:00.000Z", "Murder", "Mysuru");
    const firALast = await createFIR("a-last", officers["junior-a"]._id, "2026-09-30T23:59:59.999Z", "Fraud");
    const caseA = await createCase("a", firAFirst._id, [officers["junior-a"]._id], "2026-09-01T00:00:00.000Z");
    const caseB = await createCase("b", firOther._id, [officers["junior-b"]._id], "2026-09-15T00:00:00.000Z");
    await createCase("a-last", firALast._id, [officers["junior-a"]._id], "2026-09-30T00:00:00.000Z");

    await Evidence.create({
        evidenceId: "EX-EVIDENCE-A", caseId: caseA._id, investigationRound: 1,
        type: "Document", description: "Authorized evidence", collectedBy: officers["junior-a"]._id,
        collectionDate: "2026-09-02", location: "Evidence room",
    });
    await Evidence.create({
        evidenceId: "EX-EVIDENCE-B", caseId: caseB._id, investigationRound: 1,
        type: "Document", description: "Other officer evidence", collectedBy: officers["junior-b"]._id,
        collectionDate: "2026-09-02", location: "Evidence room",
    });
    await Report.create({
        reportId: "EX-REPORT-A", caseId: caseA._id, preparedBy: officers["junior-a"]._id,
        reportType: "Progress Report", title: "Authorized report", content: "Fixture", reportDate: "2026-09-03",
    });
    await Report.create({
        reportId: "EX-REPORT-B", caseId: caseA._id, preparedBy: officers["junior-b"]._id,
        reportType: "Progress Report", title: "Other officer report", content: "Fixture", reportDate: "2026-09-03",
    });
    await CaseHistory.create({
        caseId: caseA._id, actionType: "case_status_changed", description: "Closed by target officer",
        performedBy: users["junior-a"]._id, performedByOfficer: officers["junior-a"]._id,
        newValue: { status: "Closed" },
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("Excel export authenticates callers and denies system admin operational reports", async () => {
    assert.equal((await request(app).get("/api/reports/export/excel?type=crime-statistics")).status, 401);
    for (const type of ["crime-statistics", "monthly", "officer-performance"]) {
        const response = await request(app).get(`/api/reports/export/excel?type=${type}&month=2026-09&officerId=${officers["junior-a"]._id}`)
            .set("Authorization", `Bearer ${tokens.admin}`);
        assert.equal(response.status, 403, type);
    }
});

test("Excel export allows no body and rejects every supplied JSON body", async () => {
    const noBody = await excelRequest("crime-statistics");
    assert.equal(noBody.status, 200);

    for (const body of [{}, [], { reportData: { totalFirs: 999 } }, ["client data"]]) {
        const response = await request(app)
            .get("/api/reports/export/excel?type=crime-statistics")
            .set("Authorization", `Bearer ${tokens.juniorA}`)
            .send(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.body.error, "CLIENT_REPORT_DATA_NOT_ALLOWED");
    }
});

test("crime statistics workbook parses, respects filters and officer scope, and handles empty results", async () => {
    const response = await excelRequest("crime-statistics", {
        fromDate: "2026-09-01", toDate: "2026-09-30", city: "Bengaluru",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
    assert.match(response.headers["content-disposition"], /attachment; filename="crime-statistics-report\.xlsx"/);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(Number(response.headers["content-length"]), response.body.length);
    const workbook = await workbookFrom(response);
    const sheet = workbook.getWorksheet("Report");
    assert.ok(sheet);
    const content = sheetText(sheet);
    assert.match(content, /Crime Statistics Report/);
    assert.match(content, /Total FIRs/);
    assert.match(content, /Theft/);
    assert.match(content, /Fraud/);
    assert.doesNotMatch(content, /Murder/);
    assert.match(content, /2026-09-01/);
    assert.match(content, /2026-09-30/);

    const empty = await excelRequest("crime-statistics", { city: "NoMatchingCity" });
    assert.equal(empty.status, 200);
    assert.match(sheetText((await workbookFrom(empty)).getWorksheet("Report")), /Total FIRs\n0/);
});

test("crime statistics text is stored as a safe string and formula-like officer names are neutralized", async () => {
    const formulaText = "=HYPERLINK(\"https://example.test\")";
    const response = await excelRequest("crime-statistics", { city: formulaText });
    assert.equal(response.status, 200);
    const sheet = (await workbookFrom(response)).getWorksheet("Report");
    let cityRowNumber;
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        if (sheet.getRow(rowNumber).getCell(1).value === "City") cityRowNumber = rowNumber;
    }
    assert.ok(cityRowNumber);
    assert.equal(sheet.getCell(cityRowNumber, 2).value, `'${formulaText}`);
    assert.equal(sheet.getCell(cityRowNumber, 2).type, ExcelJS.ValueType.String);

    const own = await excelRequest("officer-performance");
    assert.equal(own.status, 200);
    const ownSheet = (await workbookFrom(own)).getWorksheet("Report");
    assert.ok(sheetText(ownSheet).includes(`'${formulaText}`));
    assert.doesNotMatch(sheetText(ownSheet), /passwordHash|passwordResetToken|secret-reset|performance score/i);
});

test("monthly workbook validates YYYY-MM, includes month boundaries, and supports an empty month", async () => {
    const response = await excelRequest("monthly", { month: "2026-09" });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-disposition"], /monthly-report-2026-09\.xlsx/);
    const sheet = (await workbookFrom(response)).getWorksheet("Report");
    assert.match(sheetText(sheet), /Monthly totals: 2026-09/);
    assert.equal(sheet.getSheetValues().find((row) => row?.[1] === "FIRs")[2], 2);
    assert.equal(sheet.getSheetValues().find((row) => row?.[1] === "Cases")[2], 2);
    assert.equal(sheet.getSheetValues().find((row) => row?.[1] === "Evidence records")[2], 1);
    assert.equal(sheet.getSheetValues().find((row) => row?.[1] === "Reports")[2], 1);

    for (const month of ["2026-9", "2026-13", "2026-09-01"]) {
        const invalid = await excelRequest("monthly", { month });
        assert.equal(invalid.status, 400, month);
        assert.equal(invalid.body.error, "INVALID_MONTH");
    }
    const empty = await excelRequest("monthly", { month: "2026-08" });
    assert.equal(empty.status, 200);
    const emptySheet = (await workbookFrom(empty)).getWorksheet("Report");
    assert.equal(emptySheet.getSheetValues().find((row) => row?.[1] === "FIRs")[2], 0);
});

test("monthly export rejects unexpected parameters and client-supplied report data", async () => {
    const unexpected = await excelRequest("monthly", { month: "2026-09", userId: users["junior-b"]._id.toString() });
    assert.equal(unexpected.status, 400);
    assert.equal(unexpected.body.error, "INVALID_MONTHLY_REPORT_FILTER");
    const body = await request(app).get("/api/reports/export/excel?type=monthly&month=2026-09")
        .set("Authorization", `Bearer ${tokens.juniorA}`)
        .send({ statistics: { firs: 999999 } });
    assert.equal(body.status, 400);
    assert.equal(body.body.error, "CLIENT_REPORT_DATA_NOT_ALLOWED");
});

test("officer performance exports self and authorized subordinate metrics only", async () => {
    const own = await excelRequest("officer-performance");
    assert.equal(own.status, 200);
    const ownSheet = (await workbookFrom(own)).getWorksheet("Report");
    const ownContent = sheetText(ownSheet);
    assert.match(ownContent, /FIRs registered/);
    assert.match(ownContent, /Currently assigned cases/);
    assert.match(ownContent, /Distinct cases closed by officer/);
    assert.match(ownContent, /Evidence for assigned cases/);
    assert.match(ownContent, /Reports prepared/);
    assert.doesNotMatch(ownContent, /performance score/i);

    const subordinate = await request(app)
        .get(`/api/reports/export/excel?type=officer-performance&officerId=${officers["junior-a"]._id}`)
        .set("Authorization", `Bearer ${tokens.inspector}`)
        .buffer(true).parse(parseBuffer);
    assert.equal(subordinate.status, 200);
    assert.match(sheetText((await workbookFrom(subordinate)).getWorksheet("Report")), /EX-junior-a/);

    for (const target of [officers["inspector-peer"], officers.dsp]) {
        const denied = await request(app)
            .get(`/api/reports/export/excel?type=officer-performance&officerId=${target._id}`)
            .set("Authorization", `Bearer ${tokens.inspector}`);
        assert.equal(denied.status, 403);
    }
});

test("Excel export rejects unsupported types and identity-spoofing query parameters", async () => {
    const unsupported = await excelRequest("unknown");
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.error, "INVALID_REPORT_TYPE");

    const manipulated = await request(app)
        .get(`/api/reports/export/excel?type=officer-performance&officerId=${officers["junior-b"]._id}&userId=${users["junior-b"]._id}&rank=sp&systemRole=system_admin`)
        .set("Authorization", `Bearer ${tokens.juniorA}`);
    assert.equal(manipulated.status, 400);
    assert.equal(manipulated.body.error, "INVALID_FILTER");

    const invalidFilters = await excelRequest("crime-statistics", { unsupported: "value" });
    assert.equal(invalidFilters.status, 400);
    assert.equal(invalidFilters.body.error, "INVALID_FILTER");
});
