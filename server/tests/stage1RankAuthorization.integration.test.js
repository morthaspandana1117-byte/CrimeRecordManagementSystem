const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "stage1-rank-authorization-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Case = require("../models/Case");
const PoliceStation = require("../models/PoliceStation");

const ranks = ["sp", "dsp", "inspector", "si", "asi", "head_constable", "constable"];
const password = "StageOne@123";
let replSet;
let app;
let adminToken;
let station;
const tokens = {};
const officers = {};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createOfficer = async (rank) => {
    const username = `stage1-${rank}`;
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const officer = await Officer.create({
        userId: user._id,
        officerId: `S1-${rank}`,
        badgeNumber: `S1${String(ranks.indexOf(rank)).padStart(4, "0")}`,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "Stage One Station",
        stationId: station._id,
        phoneNumber: "5550101000",
        address: "Stage One Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
    officers[rank] = officer;
    tokens[rank] = await login(username);
};

const createCase = (caseNo, assignedOfficerIds, status = "Open") => Case.create({
    caseNo,
    firId: new mongoose.Types.ObjectId(),
    assignedOfficerIds,
    criminalIds: [],
    title: "Stage One case",
    description: "Stage One authorization fixture",
    startDate: "2026-11-01",
    status,
    priority: "Medium",
    currentInvestigationRound: 1,
    investigationHistory: [{
        round: 1,
        startedAt: "2026-11-01",
        ...(status === "Closed" ? { closedAt: "2026-11-02", status: "Closed" } : { status: "Open" }),
    }],
});

const registrationPayload = (rank, index) => ({
    username: `registration-${rank}`,
    email: `registration-${rank}@crms.test`,
    batchNumber: `R${String(index).padStart(5, "0")}`,
    officerId: `REG-${rank}`,
    name: `Registration ${rank}`,
    rank,
    department: "Criminal Investigation",
    stationId: String(station._id),
    station: "Registration Station",
    phoneNumber: "5550101001",
    address: "Registration Avenue",
    joiningDate: "2026-01-01",
});

test.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri("crms-stage1-ranks"));
    station = await PoliceStation.create({ name: "Stage One Station", code: "STAGE1-01" });
    app = createApp();

    const admin = await User.create({
        username: "stage1-admin",
        email: "stage1-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    adminToken = await login(admin.username);

    for (const rank of ranks) await createOfficer(rank);
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await replSet.stop();
});

test("registration accepts all seven canonical ranks, rejects legacy labels, and requires approval", async () => {
    for (const [index, rank] of ranks.entries()) {
        const response = await request(app).post("/api/auth/register").send(registrationPayload(rank, index + 10));
        assert.equal(response.status, 201, rank);
        assert.equal(response.body.data.rank, rank);
        const pendingLogin = await request(app).post("/api/auth/login").send({
            username: `registration-${rank}`,
            password: `R${String(index + 10).padStart(5, "0")}`,
        });
        assert.equal(pendingLogin.status, 403);
        assert.equal(pendingLogin.body.error, "ACCOUNT_PENDING_APPROVAL");
        const officer = await Officer.findOne({ officerId: `REG-${rank}` });
        assert.equal(String(officer.stationId), String(station._id), rank);
        const approval = await request(app)
            .patch(`/api/officers/${officer._id}/approve`)
            .set("Authorization", `Bearer ${adminToken}`);
        assert.equal(approval.status, 200, rank);
        const approvedLogin = await request(app).post("/api/auth/login").send({
            username: `registration-${rank}`,
            password: `R${String(index + 10).padStart(5, "0")}`,
        });
        assert.equal(approvedLogin.status, 200, rank);
        assert.equal(approvedLogin.body.user.rank, rank);
    }

    const invalid = await request(app).post("/api/auth/register").send(registrationPayload("investigating_officer", 99));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "INVALID_OFFICER_RANK");
});

test("constable and head constable are assignment-scoped and cannot perform lifecycle operations", async () => {
    for (const rank of ["constable", "head_constable"]) {
        const ownCase = await createCase(`S1-OWN-${rank}`, [officers[rank]._id]);
        const otherCase = await createCase(`S1-OTHER-${rank}`, [officers.si._id]);
        const ownRead = await request(app)
            .get(`/api/cases/${ownCase._id}`)
            .set("Authorization", `Bearer ${tokens[rank]}`);
        assert.equal(ownRead.status, 200, rank);

        const otherEdit = await request(app)
            .put(`/api/cases/${otherCase._id}`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ title: "Unauthorized edit" });
        assert.equal(otherEdit.status, 403, rank);

        const ownStatus = await request(app)
            .patch(`/api/cases/${ownCase._id}/status`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ status: "Closed" });
        assert.equal(ownStatus.status, 403, rank);

        const ownAssignment = await request(app)
            .patch(`/api/cases/${ownCase._id}/assign-officers`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ assignedOfficerIds: [officers[rank]._id] });
        assert.equal(ownAssignment.status, 403, rank);

        const closedCase = await createCase(`S1-CLOSED-${rank}`, [officers[rank]._id], "Closed");
        const reopen = await request(app)
            .patch(`/api/cases/${closedCase._id}/reopen`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ reopenReason: "Unauthorized reopen" });
        assert.equal(reopen.status, 403, rank);
    }
});

test("higher-rank lifecycle and assignment workflows remain authorized", async () => {
    const record = await createCase("S1-INSPECTOR", [officers.inspector._id]);
    const status = await request(app)
        .patch(`/api/cases/${record._id}/status`)
        .set("Authorization", `Bearer ${tokens.inspector}`)
        .send({ status: "Closed" });
    assert.equal(status.status, 200);

    const reopened = await request(app)
        .patch(`/api/cases/${record._id}/reopen`)
        .set("Authorization", `Bearer ${tokens.inspector}`)
        .send({ reopenReason: "Authorized reopening" });
    assert.equal(reopened.status, 200);
});
