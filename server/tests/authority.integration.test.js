const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "authority-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Case = require("../models/Case");

let mongoServer;
let app;
const password = "Authority@123";
const tokens = {};
const officers = {};

const rankFixture = {
    investigating_officer: "authority-investigating",
    inspector: "authority-inspector",
    dsp: "authority-dsp",
    sp: "authority-sp",
};

const login = async (username) => {
    const response = await request(app)
        .post("/api/auth/login")
        .send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createClosedCase = async (caseNo, assignedOfficerIds = []) => Case.create({
    caseNo,
    firId: new mongoose.Types.ObjectId(),
    assignedOfficerIds,
    criminalIds: [],
    title: "Authority test case",
    description: "Authority test case",
    startDate: "2026-09-01",
    status: "Closed",
    priority: "Medium",
    currentInvestigationRound: 1,
    investigationHistory: [{
        round: 1,
        startedAt: "2026-09-01",
        closedAt: "2026-09-10",
        closureReason: "Authority test closure",
        status: "Closed",
    }],
});

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri("crms-authority");
    if (!mongoUri.startsWith("mongodb://127.0.0.1") && !mongoUri.startsWith("mongodb://localhost")) {
        throw new Error("Authority test did not receive an isolated MongoDB URI");
    }
    await mongoose.connect(mongoUri);
    app = createApp();

    const passwordHash = await bcrypt.hash(password, 10);
    for (const [rank, username] of Object.entries(rankFixture)) {
        const user = await User.create({
            username,
            email: `${username}@crms.test`,
            passwordHash,
            role: "officer",
            status: "approved",
            isActive: true,
        });
        officers[rank] = await Officer.create({
            userId: user._id,
            officerId: `AUTH-${rank.slice(0, 3).toUpperCase()}`,
            badgeNumber: `${rank === "sp" ? "SP0" : rank.slice(0, 3).toUpperCase()}001`,
            name: username,
            rank,
            department: "Criminal Investigation",
            station: "Authority Station",
            phoneNumber: "5550201000",
            address: "Authority Test Avenue",
            joiningDate: "2020-01-01",
            status: "active",
        });
        tokens[rank] = await login(username);
    }

    const systemAdmin = await User.create({
        username: "authority-system-admin",
        email: "authority-system-admin@crms.test",
        passwordHash,
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    tokens.system_admin = await login(systemAdmin.username);

    for (const [status, username] of [["pending", "authority-pending"], ["rejected", "authority-rejected"]]) {
        await User.create({
            username,
            email: `${username}@crms.test`,
            passwordHash,
            role: "officer",
            status,
            isActive: true,
        });
    }
    await User.create({
        username: "authority-inactive",
        email: "authority-inactive@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: false,
    });
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("recognizes all distinct officer ranks and protects operational boundaries", async () => {
    assert.deepEqual(
        await Officer.find().sort({ rank: 1 }).distinct("rank"),
        ["dsp", "inspector", "investigating_officer", "sp"],
    );

    const assignedCase = await createClosedCase(
        "AUTH-ASSIGNED-001",
        [officers.investigating_officer._id],
    );
    const unassignedCase = await createClosedCase("AUTH-UNASSIGNED-001", []);

    const ownCases = await request(app)
        .get("/api/cases")
        .set("Authorization", `Bearer ${tokens.investigating_officer}`);
    assert.equal(ownCases.status, 200);
    assert.deepEqual(ownCases.body.data.map((record) => record.caseNo), [assignedCase.caseNo]);

    const seniorCases = await request(app)
        .get("/api/cases")
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(seniorCases.status, 200);
    assert.equal(seniorCases.body.data.some((record) => record.caseNo === unassignedCase.caseNo), true);

    const investigatingOfficerManagement = await request(app)
        .get("/api/officers")
        .set("Authorization", `Bearer ${tokens.investigating_officer}`);
    assert.equal(investigatingOfficerManagement.status, 403);

    const inspectorOfficerManagement = await request(app)
        .get("/api/officers")
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(inspectorOfficerManagement.status, 200);

    const systemAdminOperationalCases = await request(app)
        .get("/api/cases")
        .set("Authorization", `Bearer ${tokens.system_admin}`);
    assert.equal(systemAdminOperationalCases.status, 403);

    const selfPromotion = await request(app)
        .put(`/api/officers/${officers.investigating_officer._id}`)
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({ rank: "sp" });
    assert.equal(selfPromotion.status, 403);
    assert.equal((await Officer.findById(officers.investigating_officer._id)).rank, "investigating_officer");
});

test("only Inspector, DSP, and SP can reopen cases", async () => {
    for (const rank of ["investigating_officer", "system_admin"]) {
        const record = await createClosedCase(`AUTH-REOPEN-${rank}`);
        const response = await request(app)
            .patch(`/api/cases/${record._id}/reopen`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ reopenReason: "Authority matrix test" });
        assert.equal(response.status, 403, `${rank} must not reopen cases`);
        assert.equal((await Case.findById(record._id)).status, "Closed");
    }

    for (const rank of ["inspector", "dsp", "sp"]) {
        const record = await createClosedCase(`AUTH-REOPEN-${rank}`);
        const response = await request(app)
            .patch(`/api/cases/${record._id}/reopen`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ reopenReason: "Authority matrix test" });
        assert.equal(response.status, 200, `${rank} must reopen cases`);
        const reopened = await Case.findById(record._id).lean();
        assert.equal(reopened.status, "Reopened");
        assert.equal(reopened.currentInvestigationRound, 2);
    }

    const unauthenticatedCase = await createClosedCase("AUTH-REOPEN-UNAUTH");
    const unauthenticated = await request(app)
        .patch(`/api/cases/${unauthenticatedCase._id}/reopen`)
        .send({ reopenReason: "Authority matrix test" });
    assert.equal(unauthenticated.status, 401);
});

test("pending, rejected, and inactive officers cannot log in", async () => {
    for (const username of ["authority-pending", "authority-rejected", "authority-inactive"]) {
        const response = await request(app)
            .post("/api/auth/login")
            .send({ username, password });
        assert.equal(response.status, 403, `${username} must not log in`);
    }
});
