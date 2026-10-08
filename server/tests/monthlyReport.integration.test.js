const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "monthly-report-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const Report = require("../models/Report");

let mongoServer;
let app;
const users = {};
const officers = {};
const tokens = {};
const password = "MonthlyReport@123";

const createOfficer = async (key, rank) => {
    const username = `monthly-${key}`;
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    users[key] = user;
    officers[key] = await Officer.create({
        userId: user._id,
        officerId: `MONTHLY-${key}`,
        badgeNumber: `MO${key.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase()}`,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "Monthly Station",
        phoneNumber: "5550301000",
        address: "Monthly Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createFIR = (key, registeredBy, date) => FIR.create({
    firNo: `MONTHLY-FIR-${key}`,
    date,
    policeStation: "Monthly Station",
    complaint: { complainantName: "Test Complainant", complaintText: "Test complaint" },
    description: "Monthly report fixture",
    crimeType: "Theft",
    location: { address: "1 Test Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    registeredBy,
    criminalIds: [],
    status: "Open",
});

const createCase = (key, firId, assignedOfficerIds, startDate) => Case.create({
    caseNo: `MONTHLY-CASE-${key}`,
    firId,
    assignedOfficerIds,
    criminalIds: [],
    title: `Monthly case ${key}`,
    description: "Monthly report fixture",
    startDate,
    status: "Open",
    priority: "Medium",
});

const createEvidence = (key, caseId, collectedBy, collectionDate) => Evidence.create({
    evidenceId: `MONTHLY-EVIDENCE-${key}`,
    caseId,
    investigationRound: 1,
    type: "Document",
    description: "Monthly report fixture",
    collectedBy,
    collectionDate,
    location: "Evidence room",
});

const createReport = (key, caseId, preparedBy, reportDate) => Report.create({
    reportId: `MONTHLY-REPORT-${key}`,
    caseId,
    preparedBy,
    reportType: "Progress Report",
    title: "Monthly report fixture",
    content: "Monthly report fixture",
    reportDate,
});

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-monthly-report"));
    app = createApp();

    await createOfficer("officer-a", "investigating_officer");
    await createOfficer("officer-b", "investigating_officer");
    await createOfficer("inspector", "inspector");
    users.admin = await User.create({
        username: "monthly-system-admin",
        email: "monthly-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });

    tokens.officerA = await login("monthly-officer-a");
    tokens.inspector = await login("monthly-inspector");
    tokens.admin = await login("monthly-system-admin");

    const firFirst = await createFIR("first", officers["officer-a"]._id, "2026-09-01T00:00:00.000Z");
    const firLast = await createFIR("last", officers["officer-b"]._id, "2026-09-30T23:59:59.999Z");
    const firBefore = await createFIR("before", officers["officer-a"]._id, "2026-08-31T23:59:59.999Z");
    const firAfter = await createFIR("after", officers["officer-b"]._id, "2026-10-01T00:00:00.000Z");

    const caseFirst = await createCase("first", firFirst._id, [officers["officer-a"]._id], "2026-09-01T00:00:00.000Z");
    const caseLast = await createCase("last", firLast._id, [officers["officer-b"]._id], "2026-09-30T23:59:59.999Z");
    const caseBefore = await createCase("before", firBefore._id, [officers["officer-a"]._id], "2026-08-31T23:59:59.999Z");
    const caseAfter = await createCase("after", firAfter._id, [officers["officer-b"]._id], "2026-10-01T00:00:00.000Z");

    await createEvidence("first", caseFirst._id, officers["officer-a"]._id, "2026-09-01T00:00:00.000Z");
    await createEvidence("last", caseLast._id, officers["officer-b"]._id, "2026-09-30T23:59:59.999Z");
    await createEvidence("before", caseBefore._id, officers["officer-a"]._id, "2026-08-31T23:59:59.999Z");
    await createEvidence("after", caseAfter._id, officers["officer-b"]._id, "2026-10-01T00:00:00.000Z");

    await createReport("first", caseFirst._id, officers["officer-a"]._id, "2026-09-01T00:00:00.000Z");
    await createReport("last", caseLast._id, officers["officer-b"]._id, "2026-09-30T23:59:59.999Z");
    await createReport("before", caseBefore._id, officers["officer-a"]._id, "2026-08-31T23:59:59.999Z");
    await createReport("after", caseAfter._id, officers["officer-b"]._id, "2026-10-01T00:00:00.000Z");
    await createReport("inspector", caseFirst._id, officers.inspector._id, "2026-09-15T12:00:00.000Z");
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("monthly report authenticates users and enforces operational authority boundaries", async () => {
    assert.equal((await request(app).get("/api/reports/monthly?month=2026-09")).status, 401);

    const admin = await request(app)
        .get("/api/reports/monthly?month=2026-09")
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(admin.status, 403);

    const officer = await request(app)
        .get("/api/reports/monthly?month=2026-09")
        .set("Authorization", `Bearer ${tokens.officerA}`);
    assert.equal(officer.status, 200);
});

test("monthly report strictly validates the YYYY-MM month parameter", async () => {
    const get = (query) => request(app)
        .get(`/api/reports/monthly${query}`)
        .set("Authorization", `Bearer ${tokens.officerA}`);

    assert.equal((await get("")).status, 400);
    for (const query of [
        "?month=2026-9",
        "?month=2026-00",
        "?month=2026-13",
        "?month=2026-09-01",
        "?month=2026-09T00%3A00%3A00Z",
        "?month=2026-09-01T00%3A00%3A00Z",
        "?month=abcd-09",
        "?month=2026-09&officerId=other",
        "?month=2026-09&userId=other",
        "?month=2026-09&rank=sp",
        "?month=2026-09&systemRole=system_admin",
    ]) {
        assert.equal((await get(query)).status, 400, query);
    }
});

test("monthly report applies complete UTC calendar-month boundaries to every entity", async () => {
    const response = await request(app)
        .get("/api/reports/monthly?month=2026-09")
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, {
        month: "2026-09",
        statistics: { firs: 2, cases: 2, evidence: 2, reports: 1 },
    });
});

test("monthly report applies each entity's existing data scope", async () => {
    const response = await request(app)
        .get("/api/reports/monthly?month=2026-09&officerId=monthly-officer-b")
        .set("Authorization", `Bearer ${tokens.officerA}`);
    assert.equal(response.status, 400);

    const scoped = await request(app)
        .get("/api/reports/monthly?month=2026-09")
        .set("Authorization", `Bearer ${tokens.officerA}`);
    assert.equal(scoped.status, 200);
    assert.deepEqual(scoped.body.data.statistics, { firs: 1, cases: 1, evidence: 1, reports: 1 });
});

test("monthly report returns zero statistics for a month with no records", async () => {
    const response = await request(app)
        .get("/api/reports/monthly?month=2027-04")
        .set("Authorization", `Bearer ${tokens.officerA}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, {
        month: "2027-04",
        statistics: { firs: 0, cases: 0, evidence: 0, reports: 0 },
    });
});
