const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "report-pdf-integration-test-secret";

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
const password = "ReportPDF@123";

const createOfficer = async (key, rank) => {
    const username = `pdf-${key}`;
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
        officerId: `PDF-${key}`,
        badgeNumber: `PD${key.replace(/[^a-z0-9]/gi, "").slice(-4).padStart(4, "0").toUpperCase()}`,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "PDF Station",
        phoneNumber: "5550501000",
        address: "PDF Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createFIR = (key, registeredBy, date, crimeType, city = "Bengaluru") => FIR.create({
    firNo: `PDF-FIR-${key}`,
    date,
    policeStation: "PDF Station",
    complaint: { complainantName: "Test Complainant", complaintText: "Test complaint" },
    description: "PDF report fixture",
    crimeType,
    location: { address: "1 Test Road", city, state: "Karnataka", pincode: "560001" },
    registeredBy,
    criminalIds: [],
    status: "Open",
});

const createCase = (key, firId, assignedOfficerIds, startDate) => Case.create({
    caseNo: `PDF-CASE-${key}`,
    firId,
    assignedOfficerIds,
    criminalIds: [],
    title: `PDF case ${key}`,
    description: "PDF report fixture",
    startDate,
    status: "Open",
    priority: "Medium",
});

const pdfBytes = (response) => response.body.toString("latin1");
const pdfText = (response) => [...pdfBytes(response).matchAll(/<([0-9a-f]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, "hex").toString("latin1"))
    .join("");

const exportRequest = (type, query = "") => request(app)
    .get(`/api/reports/export/pdf?type=${type}${query}`)
    .set("Authorization", `Bearer ${tokens.juniorA}`);

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-report-pdf"));
    app = createApp();

    await createOfficer("junior-a", "constable");
    await createOfficer("junior-b", "constable");
    await createOfficer("inspector", "inspector");
    await createOfficer("inspector-peer", "inspector");
    await createOfficer("dsp", "dsp");
    users.admin = await User.create({
        username: "pdf-system-admin",
        email: "pdf-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });

    tokens.juniorA = await login("pdf-junior-a");
    tokens.juniorB = await login("pdf-junior-b");
    tokens.inspector = await login("pdf-inspector");
    tokens.admin = await login("pdf-system-admin");

    const firA = await createFIR("a", officers["junior-a"]._id, "2026-09-01T00:00:00.000Z", "Theft");
    const firB = await createFIR("b", officers["junior-b"]._id, "2026-09-15T12:00:00.000Z", "Murder");
    const firOutside = await createFIR("outside", officers["junior-a"]._id, "2026-10-01T00:00:00.000Z", "Fraud");
    const caseA = await createCase("a", firA._id, [officers["junior-a"]._id], "2026-09-01T00:00:00.000Z");
    const caseB = await createCase("b", firB._id, [officers["junior-b"]._id], "2026-09-15T00:00:00.000Z");
    await createCase("outside", firOutside._id, [officers["junior-a"]._id], "2026-10-01T00:00:00.000Z");

    await Evidence.create({
        evidenceId: "PDF-EVIDENCE-A",
        caseId: caseA._id,
        investigationRound: 1,
        type: "Document",
        description: "PDF report evidence",
        collectedBy: officers["junior-a"]._id,
        collectionDate: "2026-09-02",
        location: "Evidence room",
    });
    await Evidence.create({
        evidenceId: "PDF-EVIDENCE-B",
        caseId: caseB._id,
        investigationRound: 1,
        type: "Document",
        description: "Other officer evidence",
        collectedBy: officers["junior-b"]._id,
        collectionDate: "2026-09-02",
        location: "Evidence room",
    });
    await Report.create({
        reportId: "PDF-REPORT-A",
        caseId: caseA._id,
        preparedBy: officers["junior-a"]._id,
        reportType: "Progress Report",
        title: "PDF report data",
        content: "Authorized report content",
        reportDate: "2026-09-03",
    });
    await Report.create({
        reportId: "PDF-REPORT-B",
        caseId: caseA._id,
        preparedBy: officers["junior-b"]._id,
        reportType: "Progress Report",
        title: "Other officer report",
        content: "Must not be counted for junior A",
        reportDate: "2026-09-03",
    });
    await CaseHistory.create({
        caseId: caseA._id,
        actionType: "case_status_changed",
        description: "Case closed by target officer",
        performedBy: users["junior-a"]._id,
        performedByOfficer: officers["junior-a"]._id,
        newValue: { status: "Closed" },
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("PDF export authenticates callers and denies system admin operational reports", async () => {
    assert.equal((await request(app).get("/api/reports/export/pdf?type=crime-statistics")).status, 401);
    for (const type of ["crime-statistics", "monthly", "officer-performance"]) {
        const response = await request(app)
            .get(`/api/reports/export/pdf?type=${type}&month=2026-09&officerId=${officers["junior-a"]._id}`)
            .set("Authorization", `Bearer ${tokens.admin}`);
        assert.equal(response.status, 403, type);
    }
});

test("PDF export allows no body and rejects every supplied JSON body", async () => {
    const noBody = await exportRequest("crime-statistics");
    assert.equal(noBody.status, 200);

    for (const body of [{}, [], { reportData: { totalFirs: 999 } }, ["client data"]]) {
        const response = await request(app)
            .get("/api/reports/export/pdf?type=crime-statistics")
            .set("Authorization", `Bearer ${tokens.juniorA}`)
            .send(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.body.error, "CLIENT_REPORT_DATA_NOT_ALLOWED");
    }
});

test("crime statistics PDF uses authorized server data and safe response headers", async () => {
    const response = await exportRequest("crime-statistics", "&fromDate=2026-09-01&toDate=2026-09-30");
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /application\/pdf/);
    assert.match(response.headers["content-disposition"], /attachment; filename="crime-statistics-report\.pdf"/);
    const content = pdfText(response);
    assert.ok(pdfBytes(response).startsWith("%PDF-"));
    assert.match(content, /Crime Statistics Report/);
    assert.match(content, /Total FIRs: 1/);
    assert.match(content, /Theft: 1/);
    assert.doesNotMatch(content, /Murder: 1/);
    assert.doesNotMatch(content, /Fraud: 1/);
});

test("monthly PDF validates month and honors the selected calendar month", async () => {
    const response = await exportRequest("monthly", "&month=2026-09");
    assert.equal(response.status, 200);
    assert.match(response.headers["content-disposition"], /monthly-report-2026-09\.pdf/);
    assert.match(pdfText(response), /FIRs: 1/);

    const invalid = await exportRequest("monthly", "&month=2026-09-01");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "INVALID_MONTH");
});

test("officer performance PDF enforces self and subordinate target rules", async () => {
    const own = await exportRequest("officer-performance");
    assert.equal(own.status, 200);
    assert.match(pdfText(own), /performance/i);
    assert.match(pdfText(own), /FIRs registered: 2/);
    assert.match(pdfText(own), /Currently assigned cases: 2/);
    assert.match(pdfText(own), /Reports prepared: 1/);

    const subordinate = await request(app)
        .get(`/api/reports/export/pdf?type=officer-performance&officerId=${officers["junior-a"]._id}`)
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(subordinate.status, 200);

    for (const target of [officers["inspector-peer"], officers.dsp]) {
        const denied = await request(app)
            .get(`/api/reports/export/pdf?type=officer-performance&officerId=${target._id}`)
            .set("Authorization", `Bearer ${tokens.inspector}`);
        assert.equal(denied.status, 403);
    }
});

test("PDF export rejects unknown report types, invalid targets, and client-supplied report data", async () => {
    const unsupported = await exportRequest("excel");
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.error, "INVALID_REPORT_TYPE");

    const invalidOfficer = await exportRequest("officer-performance", "&officerId=not-an-id");
    assert.equal(invalidOfficer.status, 400);

    const spoofed = await request(app)
        .get("/api/reports/export/pdf?type=crime-statistics")
        .set("Authorization", `Bearer ${tokens.juniorA}`)
        .send({ totalFIRs: 999999, totalCases: 999999, performanceScore: 100, reportData: { totalFIRs: 999999 } });
    assert.equal(spoofed.status, 400);
    assert.equal(spoofed.body.error, "CLIENT_REPORT_DATA_NOT_ALLOWED");

    const manipulated = await request(app)
        .get(`/api/reports/export/pdf?type=officer-performance&officerId=${officers["junior-b"]._id}&userId=${users["junior-b"]._id}&rank=sp&systemRole=system_admin`)
        .set("Authorization", `Bearer ${tokens.juniorA}`);
    assert.equal(manipulated.status, 400);
});

test("empty authorized report data still produces a valid PDF without sensitive fields", async () => {
    const response = await exportRequest("crime-statistics", "&city=NoMatchingCity");
    assert.equal(response.status, 200);
    const content = pdfText(response);
    assert.ok(pdfBytes(response).startsWith("%PDF-"));
    assert.match(content, /Total FIRs: 0/);
    for (const field of ["passwordHash", "passwordResetToken", "passwordResetExpires", "metadata", "Authorization", "secret-reset"]) {
        assert.equal(content.includes(field), false, `${field} must not appear in PDF`);
    }
});
