const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "officer-performance-integration-test-secret";

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
const password = "OfficerPerformance@123";

const createOfficer = async (key, rank) => {
    const username = `performance-${key}`;
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
        passwordResetToken: `secret-reset-${key}`,
    });
    users[key] = user;
    officers[key] = await Officer.create({
        userId: user._id,
        officerId: `PERF-${key}`,
        badgeNumber: `PF${key.replace(/[^a-z0-9]/gi, "").slice(-4).padStart(4, "0").toUpperCase()}`,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "Performance Station",
        phoneNumber: "5550401000",
        address: "Performance Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createFIR = (key, registeredBy) => FIR.create({
    firNo: `PERF-FIR-${key}`,
    date: "2026-09-01",
    policeStation: "Performance Station",
    complaint: { complainantName: "Test Complainant", complaintText: "Test complaint" },
    description: "Performance fixture",
    crimeType: "Theft",
    location: { address: "1 Test Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    registeredBy,
    criminalIds: [],
    status: "Open",
});

const createCase = (key, firId, assignedOfficerIds) => Case.create({
    caseNo: `PERF-CASE-${key}`,
    firId,
    assignedOfficerIds,
    criminalIds: [],
    title: `Performance case ${key}`,
    description: "Performance fixture",
    startDate: "2026-09-01",
    status: "Open",
    priority: "Medium",
});

const createEvidence = (key, caseId, collectedBy) => Evidence.create({
    evidenceId: `PERF-EVIDENCE-${key}`,
    caseId,
    investigationRound: 1,
    type: "Document",
    description: "Performance fixture",
    collectedBy,
    collectionDate: "2026-09-02",
    location: "Evidence room",
});

const createReport = (key, caseId, preparedBy) => Report.create({
    reportId: `PERF-REPORT-${key}`,
    caseId,
    preparedBy,
    reportType: "Progress Report",
    title: "Performance fixture",
    content: "Performance fixture",
    reportDate: "2026-09-03",
});

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-officer-performance"));
    app = createApp();

    await createOfficer("junior-a", "constable");
    await createOfficer("junior-b", "constable");
    await createOfficer("inspector", "inspector");
    await createOfficer("inspector-peer", "inspector");
    await createOfficer("dsp", "dsp");
    users.admin = await User.create({
        username: "performance-system-admin",
        email: "performance-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });

    tokens.juniorA = await login("performance-junior-a");
    tokens.juniorB = await login("performance-junior-b");
    tokens.inspector = await login("performance-inspector");
    tokens.admin = await login("performance-system-admin");

    const firA = await createFIR("a", officers["junior-a"]._id);
    const firB = await createFIR("b", officers["junior-b"]._id);
    const caseA = await createCase("a", firA._id, [officers["junior-a"]._id]);
    const caseB = await createCase("b", firB._id, [officers["junior-b"]._id]);
    const caseShared = await createCase("shared", new mongoose.Types.ObjectId(), [officers["junior-a"]._id, officers["junior-b"]._id]);

    await createEvidence("a", caseA._id, officers["junior-a"]._id);
    await createEvidence("b", caseB._id, officers["junior-b"]._id);
    await createEvidence("shared", caseShared._id, officers["junior-b"]._id);
    await createReport("a", caseA._id, officers["junior-a"]._id);
    await createReport("b", caseA._id, officers["junior-b"]._id);

    await CaseHistory.create({
        caseId: caseA._id,
        actionType: "case_status_changed",
        description: "Case closed by target officer",
        performedBy: users["junior-a"]._id,
        performedByOfficer: officers["junior-a"]._id,
        performedByRole: "officer",
        performedByRank: "investigating_officer",
        previousValue: { status: "Under Investigation" },
        newValue: { status: "Closed" },
    });
    await CaseHistory.create({
        caseId: caseB._id,
        actionType: "case_status_changed",
        description: "Case closed by another officer",
        performedBy: users["junior-b"]._id,
        performedByOfficer: officers["junior-b"]._id,
        performedByRole: "officer",
        performedByRank: "investigating_officer",
        previousValue: { status: "Under Investigation" },
        newValue: { status: "Closed" },
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("officers can retrieve their own objective performance metrics", async () => {
    const response = await request(app)
        .get("/api/reports/officer-performance")
        .set("Authorization", `Bearer ${tokens.juniorA}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.metrics, {
        firsRegistered: 1,
        currentlyAssignedCases: 2,
        distinctCasesClosedByOfficer: 1,
        evidenceForAssignedCases: 2,
        reportsPrepared: 1,
    });
    assert.deepEqual(response.body.data.officer, {
        officerId: officers["junior-a"].officerId,
        name: "performance-junior-a",
        rank: "constable",
        department: "Criminal Investigation",
        station: "Performance Station",
    });
});

test("target selection follows the existing strict officer hierarchy", async () => {
    const subordinate = await request(app)
        .get(`/api/reports/officer-performance?officerId=${officers["junior-a"]._id}`)
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(subordinate.status, 200);

    for (const target of [officers["inspector-peer"], officers.dsp]) {
        const denied = await request(app)
            .get(`/api/reports/officer-performance?officerId=${target._id}`)
            .set("Authorization", `Bearer ${tokens.inspector}`);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error, "OFFICER_PERFORMANCE_ACCESS_DENIED");
    }

    const ordinaryOfficer = await request(app)
        .get(`/api/reports/officer-performance?officerId=${officers["junior-b"]._id}`)
        .set("Authorization", `Bearer ${tokens.juniorA}`);
    assert.equal(ordinaryOfficer.status, 403);
});

test("admin, unauthenticated, manipulated, and invalid target requests are rejected safely", async () => {
    assert.equal((await request(app).get("/api/reports/officer-performance")).status, 401);

    const admin = await request(app)
        .get(`/api/reports/officer-performance?officerId=${officers["junior-a"]._id}`)
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(admin.status, 403);

    for (const query of [
        "officerId=",
        "officerId=invalid",
        `officerId=${new mongoose.Types.ObjectId()}`,
        `officerId=${officers["junior-b"]._id}&userId=${users["junior-b"]._id}`,
        `officerId=${officers["junior-b"]._id}&rank=sp`,
        `officerId=${officers["junior-b"]._id}&systemRole=system_admin`,
        "performanceScore=100",
    ]) {
        const response = await request(app)
            .get(`/api/reports/officer-performance?${query}`)
            .set("Authorization", `Bearer ${tokens.juniorA}`);
        assert.ok([400, 403, 404].includes(response.status), query);
    }
});

test("performance response omits credentials and internal user or audit fields", async () => {
    const response = await request(app)
        .get("/api/reports/officer-performance")
        .set("Authorization", `Bearer ${tokens.juniorA}`);
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(response.body);
    for (const secret of ["password", "passwordHash", "passwordResetToken", "passwordResetExpires", "metadata", "performedBy"]) {
        assert.equal(serialized.includes(secret), false, `${secret} must not be returned`);
    }
});
