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
const Report = require("../models/Report");

let mongoServer;
let app;
const password = "Authority@123";
const tokens = {};
const officers = {};
let accountStatusTarget;

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
    const targetUser = await User.create({
        username: "authority-status-target",
        email: "authority-status-target@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    accountStatusTarget = await Officer.create({
        userId: targetUser._id,
        officerId: "AUTH-TARGET-001",
        badgeNumber: "TARG01",
        name: "Account Status Target",
        rank: "investigating_officer",
        department: "Criminal Investigation",
        station: "Authority Station",
        phoneNumber: "5550201001",
        address: "Authority Target Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
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
    assert.equal(inspectorOfficerManagement.status, 403);

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

test("all case-edit ranks are blocked from editing a closed case", async () => {
    const record = await createClosedCase("AUTH-CLOSED-EDIT", [officers.investigating_officer._id]);
    for (const rank of ["investigating_officer", "inspector", "dsp", "sp"]) {
        const response = await request(app)
            .put(`/api/cases/${record._id}`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ title: `Attempt by ${rank}` });
        assert.equal(response.status, 409, `${rank} must not edit a closed case`);
        assert.equal(response.body.error, "CASE_CLOSED_READ_ONLY");
    }
    assert.equal((await Case.findById(record._id)).title, "Authority test case");
});

test("pending, rejected, and inactive officers cannot log in", async () => {
    for (const username of ["authority-pending", "authority-rejected", "authority-inactive"]) {
        const response = await request(app)
            .post("/api/auth/login")
            .send({ username, password });
        assert.equal(response.status, 403, `${username} must not log in`);
    }
});

test("Officer Management permissions follow system role, not officer rank", async () => {
    for (const rank of ["investigating_officer", "inspector", "dsp", "sp"]) {
        const deniedList = await request(app)
            .get("/api/officers")
            .set("Authorization", `Bearer ${tokens[rank]}`);
        const deniedDetails = await request(app)
            .get(`/api/officers/${officers[rank]._id}`)
            .set("Authorization", `Bearer ${tokens[rank]}`);
        const deniedStatus = await request(app)
            .patch(`/api/officers/${accountStatusTarget._id}/status`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ accountStatus: "inactive" });
        assert.equal(deniedList.status, 403, `${rank} must not list officers`);
        assert.equal(deniedDetails.status, 403, `${rank} must not view officer details`);
        assert.equal(deniedStatus.status, 403, `${rank} must not change officer account status`);
    }

    const adminList = await request(app)
        .get("/api/officers")
        .set("Authorization", `Bearer ${tokens.system_admin}`);
    assert.equal(adminList.status, 200);
    const adminAccount = adminList.body.data.find((record) => String(record._id) === String(accountStatusTarget._id));
    assert.ok(adminAccount);
    assert.deepEqual(Object.keys(adminAccount).sort(), ["_id", "accountStatus", "approvalStatus", "email", "username"]);

    const adminDetails = await request(app)
        .get(`/api/officers/${accountStatusTarget._id}`)
        .set("Authorization", `Bearer ${tokens.system_admin}`);
    assert.equal(adminDetails.status, 200);

    const adminDeactivate = await request(app)
        .patch(`/api/officers/${accountStatusTarget._id}/status`)
        .set("Authorization", `Bearer ${tokens.system_admin}`)
        .send({ accountStatus: "inactive" });
    const adminActivate = await request(app)
        .patch(`/api/officers/${accountStatusTarget._id}/status`)
        .set("Authorization", `Bearer ${tokens.system_admin}`)
        .send({ accountStatus: "active" });
    assert.equal(adminDeactivate.status, 200);
    assert.equal(adminActivate.status, 200);

    const adminAssignableOfficers = await request(app)
        .get("/api/officers/assignable")
        .set("Authorization", `Bearer ${tokens.system_admin}`);
    assert.equal(adminAssignableOfficers.status, 200);
});

test("report creation rejects a spoofed preparedBy value instead of trusting client input", async () => {
    const caseRecord = await Case.findOne({ caseNo: "AUTH-ASSIGNED-001" }).lean();
    const response = await request(app)
        .post("/api/reports")
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({
            reportId: "RPT-SEC-002",
            caseId: caseRecord._id.toString(),
            preparedBy: officers.dsp._id.toString(),
            reportType: "Progress Report",
            title: "Authenticated author test",
            content: "This report should be rejected because the client tried to spoof the author.",
            reportDate: "2026-09-12",
            status: "Draft",
        });

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "REPORT_PREPARED_BY_FORBIDDEN");
});

test("investigating officers can update reports only for cases assigned to them", async () => {
    const assignedCase = await createClosedCase(
        "AUTH-REPORT-ASSIGNED-001",
        [officers.investigating_officer._id],
    );
    const secondAssignedCase = await createClosedCase(
        "AUTH-REPORT-ASSIGNED-002",
        [officers.investigating_officer._id],
    );
    const unassignedCase = await createClosedCase("AUTH-REPORT-UNASSIGNED-001", []);
    const report = await Report.create({
        reportId: "AUTH-REPORT-UPDATE-001",
        caseId: assignedCase._id,
        preparedBy: officers.investigating_officer._id,
        reportType: "Progress Report",
        title: "Assignment update test",
        content: "Report content",
        reportDate: "2026-09-12",
        status: "Draft",
    });

    const keepAssignedCase = await request(app)
        .put(`/api/reports/${report._id}`)
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({ caseId: assignedCase._id.toString(), title: "Updated assigned case" });
    assert.equal(keepAssignedCase.status, 200);
    assert.equal(String(keepAssignedCase.body.data.caseId._id), String(assignedCase._id));

    const unassignedChange = await request(app)
        .put(`/api/reports/${report._id}`)
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({ caseId: unassignedCase._id.toString() });
    assert.equal(unassignedChange.status, 403);
    assert.equal(unassignedChange.body.error, "REPORT_CASE_ACCESS_DENIED");
    assert.equal(String((await Report.findById(report._id)).caseId), String(assignedCase._id));

    const assignedChange = await request(app)
        .put(`/api/reports/${report._id}`)
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({ caseId: secondAssignedCase._id.toString() });
    assert.equal(assignedChange.status, 200);
    assert.equal(String(assignedChange.body.data.caseId._id), String(secondAssignedCase._id));

    const spoofedCaseChange = await request(app)
        .put(`/api/reports/${report._id}`)
        .set("Authorization", `Bearer ${tokens.investigating_officer}`)
        .send({
            caseId: unassignedCase._id.toString(),
            preparedBy: officers.investigating_officer._id.toString(),
            userId: officers.inspector._id.toString(),
            rank: "sp",
            systemRole: "system_admin",
        });
    assert.equal(spoofedCaseChange.status, 403);
    assert.equal(spoofedCaseChange.body.error, "REPORT_CASE_ACCESS_DENIED");
    const unchanged = await Report.findById(report._id).lean();
    assert.equal(String(unchanged.caseId), String(secondAssignedCase._id));
    assert.equal(String(unchanged.preparedBy), String(officers.investigating_officer._id));

    const seniorReport = await Report.create({
        reportId: "AUTH-REPORT-UPDATE-SENIOR",
        caseId: assignedCase._id,
        preparedBy: officers.inspector._id,
        reportType: "Progress Report",
        title: "Senior update test",
        content: "Report content",
        reportDate: "2026-09-12",
        status: "Draft",
    });
    const seniorChange = await request(app)
        .put(`/api/reports/${seniorReport._id}`)
        .set("Authorization", `Bearer ${tokens.inspector}`)
        .send({ caseId: unassignedCase._id.toString() });
    assert.equal(seniorChange.status, 200);
    assert.equal(String(seniorChange.body.data.caseId._id), String(unassignedCase._id));
});
