const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
// Officer registration writes User and Officer in a transaction, which
// requires a replica set rather than a standalone in-memory server.
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "auth-flow-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const PoliceStation = require("../models/PoliceStation");

let replSet;
let app;
let adminToken;
let station;

const registrationPayload = (overrides = {}) => ({
    username: "flow-officer",
    email: "Flow.Officer@crms.test",
    batchNumber: "FLW001",
    officerId: "FLOW-OFF-001",
    name: "Flow Officer",
    rank: "si",
    department: "Criminal Investigation",
    stationId: String(station?._id || ""),
    station: "Flow Station",
    phoneNumber: "5550101010",
    address: "Flow Street",
    joiningDate: "2021-06-01",
    ...overrides,
});

const login = (username, password) =>
    request(app).post("/api/auth/login").send({ username, password });

const registerAndApprove = async (overrides) => {
    const payload = registrationPayload(overrides);
    const registered = await request(app).post("/api/auth/register").send(payload);
    assert.equal(registered.status, 201);
    const approved = await request(app)
        .patch(`/api/officers/${registered.body.data.id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(approved.status, 200);
    const loggedIn = await login(payload.username, payload.batchNumber);
    assert.equal(loggedIn.status, 200);
    return { officerId: registered.body.data.id, token: loggedIn.body.token, userId: loggedIn.body.user.id };
};

test.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri("crms-auth-flow"));
    await Promise.all([User.init(), Officer.init()]);
    station = await PoliceStation.create({ name: "Auth Flow Station", code: "AUTH-FLOW-01" });
    app = createApp();

    await User.create({
        username: "flow-admin",
        email: "flow-admin@crms.test",
        passwordHash: await bcrypt.hash("FlowAdmin@123", 10),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    const adminLogin = await login("flow-admin", "FlowAdmin@123");
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.body.token;
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await replSet.stop();
});

test("login issues tokens only for eligible officers and preserves system-admin login", async () => {
    const valid = await registerAndApprove({
        username: "eligibility-valid",
        email: "eligibility-valid@crms.test",
        batchNumber: "ELG001",
        officerId: "ELG-OFF-001",
    });
    const validLogin = await login("eligibility-valid", "ELG001");
    assert.equal(validLogin.status, 200);
    assert.ok(validLogin.body.token);
    assert.equal(validLogin.body.user.status, "approved");
    assert.equal((await Officer.findOne({ userId: valid.userId })).status, "active");

    const missing = await registerAndApprove({
        username: "eligibility-missing",
        email: "eligibility-missing@crms.test",
        batchNumber: "ELG002",
        officerId: "ELG-OFF-002",
    });
    await Officer.deleteOne({ userId: missing.userId });
    const missingLogin = await login("eligibility-missing", "ELG002");
    assert.equal(missingLogin.status, 403);
    assert.equal(missingLogin.body.error, "OFFICER_INELIGIBLE");
    assert.equal(missingLogin.body.token, undefined);

    const inactive = await registerAndApprove({
        username: "eligibility-inactive",
        email: "eligibility-inactive@crms.test",
        batchNumber: "ELG003",
        officerId: "ELG-OFF-003",
    });
    await Officer.updateOne({ userId: inactive.userId }, { $set: { status: "inactive" } });
    const inactiveLogin = await login("eligibility-inactive", "ELG003");
    assert.equal(inactiveLogin.status, 403);
    assert.equal(inactiveLogin.body.error, "OFFICER_INELIGIBLE");
    assert.equal(inactiveLogin.body.token, undefined);

    const unapproved = await registerAndApprove({
        username: "eligibility-unapproved",
        email: "eligibility-unapproved@crms.test",
        batchNumber: "ELG004",
        officerId: "ELG-OFF-004",
    });
    await User.updateOne({ _id: unapproved.userId }, { $set: { status: "pending" } });
    const unapprovedLogin = await login("eligibility-unapproved", "ELG004");
    assert.equal(unapprovedLogin.status, 403);
    assert.equal(unapprovedLogin.body.error, "ACCOUNT_PENDING_APPROVAL");
    assert.equal(unapprovedLogin.body.token, undefined);

    const invalidRank = await registerAndApprove({
        username: "eligibility-rank",
        email: "eligibility-rank@crms.test",
        batchNumber: "ELG005",
        officerId: "ELG-OFF-005",
    });
    await Officer.collection.updateOne(
        { userId: new mongoose.Types.ObjectId(invalidRank.userId) },
        { $set: { rank: "unrecognized_rank" } },
    );
    const invalidRankLogin = await login("eligibility-rank", "ELG005");
    assert.equal(invalidRankLogin.status, 403);
    assert.equal(invalidRankLogin.body.error, "OFFICER_RANK_REQUIRED");
    assert.equal(invalidRankLogin.body.token, undefined);

    const adminLogin = await login("flow-admin", "FlowAdmin@123");
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.user.systemRole, "system_admin");
    assert.ok(adminLogin.body.token);
});

test("/auth/me rechecks current eligibility for officers and preserves system-admin access", async () => {
    const eligible = await registerAndApprove({
        username: "me-eligible",
        email: "me-eligible@crms.test",
        batchNumber: "MEE001",
        officerId: "MEE-OFF-001",
    });
    const eligibleMe = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${eligible.token}`);
    assert.equal(eligibleMe.status, 200);
    assert.equal(eligibleMe.body.data.systemRole, "officer");
    assert.equal(eligibleMe.body.data.status, "approved");

    const deactivated = await request(app)
        .patch(`/api/officers/${eligible.officerId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ accountStatus: "inactive" });
    assert.equal(deactivated.status, 200);
    const meAfterDeactivation = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${eligible.token}`);
    assert.equal(meAfterDeactivation.status, 403);
    assert.equal(meAfterDeactivation.body.error, "ACCOUNT_INACTIVE");
    assert.equal(meAfterDeactivation.body.data, undefined);

    const ineligible = await registerAndApprove({
        username: "me-ineligible",
        email: "me-ineligible@crms.test",
        batchNumber: "MEE002",
        officerId: "MEE-OFF-002",
    });
    await Officer.updateOne({ userId: ineligible.userId }, { $set: { status: "suspended" } });
    const meForIneligibleOfficer = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${ineligible.token}`);
    assert.equal(meForIneligibleOfficer.status, 403);
    assert.equal(meForIneligibleOfficer.body.error, "OFFICER_INELIGIBLE");
    assert.equal(meForIneligibleOfficer.body.data, undefined);

    const adminMe = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(adminMe.status, 200);
    assert.equal(adminMe.body.data.systemRole, "system_admin");
});

test("registered officers stay locked out until an admin approves them, then gain operational access", async () => {
    const payload = registrationPayload();
    const registered = await request(app).post("/api/auth/register").send(payload);
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data.status, "pending");

    const user = await User.findOne({ username: "flow-officer" });
    assert.equal(user.status, "pending");
    assert.equal(user.email, "flow.officer@crms.test");
    assert.notEqual(user.passwordHash, payload.batchNumber, "the initial password must be stored hashed");
    const officer = await Officer.findOne({ userId: user._id });
    assert.equal(String(officer._id), String(registered.body.data.id));
    assert.equal(officer.rank, "si");
    assert.equal(String(officer.stationId), String(station._id));
    assert.equal(officer.station, station.name);
    assert.equal(user.isActive, false);

    const duplicate = await request(app)
        .post("/api/auth/register")
        .send(registrationPayload({ officerId: "FLOW-OFF-999", batchNumber: "FLW999" }));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "USER_ALREADY_EXISTS");
    assert.equal(await User.countDocuments({ username: "flow-officer" }), 1);

    const invalidBatch = await request(app)
        .post("/api/auth/register")
        .send(registrationPayload({ username: "flow-bad", email: "flow-bad@crms.test", officerId: "FLOW-BAD", batchNumber: "12" }));
    assert.equal(invalidBatch.status, 400);
    assert.equal(invalidBatch.body.error, "INVALID_BATCH_NUMBER");
    assert.equal(await User.exists({ username: "flow-bad" }), null);

    const pendingLogin = await login("flow-officer", payload.batchNumber);
    assert.equal(pendingLogin.status, 403);
    assert.equal(pendingLogin.body.error, "ACCOUNT_PENDING_APPROVAL");
    assert.equal(pendingLogin.body.token, undefined);

    const unauthenticatedApprove = await request(app)
        .patch(`/api/officers/${officer._id}/approve`)
        .send();
    assert.equal(unauthenticatedApprove.status, 401);
    assert.equal((await User.findById(user._id)).status, "pending");

    const approved = await request(app)
        .patch(`/api/officers/${officer._id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.status, "approved");
    assert.equal((await User.findById(user._id)).status, "approved");
    assert.equal((await User.findById(user._id)).isActive, true);
    const assignedOfficer = await Officer.findById(officer._id);
    assert.equal(String(assignedOfficer.stationId), String(station._id));
    assert.equal(assignedOfficer.station, station.name);
    assert.equal(assignedOfficer.station, station.name);

    const approveAgain = await request(app)
        .patch(`/api/officers/${officer._id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(approveAgain.status, 409);
    assert.equal(approveAgain.body.error, "OFFICER_NOT_PENDING");

    const approvedLogin = await login("flow-officer", payload.batchNumber);
    assert.equal(approvedLogin.status, 200);
    assert.equal(approvedLogin.body.user.systemRole, "officer");
    assert.equal(approvedLogin.body.user.rank, "si");

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${approvedLogin.body.token}`);
    assert.equal(me.status, 200);

    const firs = await request(app).get("/api/firs").set("Authorization", `Bearer ${approvedLogin.body.token}`);
    assert.equal(firs.status, 200);
    assert.equal(firs.body.success, true);
});

test("protected endpoints reject missing, malformed, tampered, foreign-signed, and expired tokens", async () => {
    const { token, userId } = await registerAndApprove({
        username: "flow-token",
        email: "flow-token@crms.test",
        batchNumber: "FLW002",
        officerId: "FLOW-OFF-002",
    });
    const payload = { userId, username: "flow-token", role: "officer", systemRole: "officer" };
    const [header, body, signature] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, systemRole: "system_admin", role: "admin" })).toString("base64url");
    const lastChar = signature.at(-1) === "A" ? "B" : "A";

    const cases = [
        ["missing header", undefined, "TOKEN_REQUIRED"],
        ["non-Bearer scheme", `Basic ${token}`, "TOKEN_REQUIRED"],
        ["garbage token", "Bearer not.a.jwt", "INVALID_TOKEN"],
        ["altered signature", `Bearer ${header}.${body}.${signature.slice(0, -1)}${lastChar}`, "INVALID_TOKEN"],
        ["altered payload", `Bearer ${header}.${tamperedPayload}.${signature}`, "INVALID_TOKEN"],
        ["foreign secret", `Bearer ${jwt.sign(payload, "some-other-secret", { expiresIn: "1h" })}`, "INVALID_TOKEN"],
        [
            "expired token",
            `Bearer ${jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET)}`,
            "TOKEN_EXPIRED",
        ],
    ];

    for (const [label, authorization, expectedError] of cases) {
        for (const path of ["/api/firs", "/api/criminals", "/api/auth/me"]) {
            const req = request(app).get(path);
            if (authorization) req.set("Authorization", authorization);
            const response = await req;
            assert.equal(response.status, 401, `${label} on ${path}`);
            assert.equal(response.body.success, false, `${label} on ${path}`);
            assert.equal(response.body.error, expectedError, `${label} on ${path}`);
            assert.equal(response.body.data, undefined, `${label} on ${path} must not return data`);
        }
    }

    const valid = await request(app).get("/api/firs").set("Authorization", `Bearer ${token}`);
    assert.equal(valid.status, 200, "the untampered token still works");
});

test("an issued token stops granting access once the officer account is deactivated", async () => {
    const { officerId, token } = await registerAndApprove({
        username: "flow-deactivate",
        email: "flow-deactivate@crms.test",
        batchNumber: "FLW003",
        officerId: "FLOW-OFF-003",
    });

    const before = await request(app).get("/api/firs").set("Authorization", `Bearer ${token}`);
    assert.equal(before.status, 200);

    const deactivated = await request(app)
        .patch(`/api/officers/${officerId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ accountStatus: "inactive" });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.data.accountStatus, "inactive");

    for (const path of ["/api/firs", "/api/criminals", "/api/cases", "/api/evidence", "/api/dashboard/stats"]) {
        const response = await request(app).get(path).set("Authorization", `Bearer ${token}`);
        assert.equal(response.status, 403, `deactivated token on ${path}`);
        assert.equal(response.body.error, "ACCOUNT_INACTIVE", `deactivated token on ${path}`);
    }

    const relogin = await login("flow-deactivate", "FLW003");
    assert.equal(relogin.status, 403);
    assert.equal(relogin.body.error, "ACCOUNT_INACTIVE");

    const reactivated = await request(app)
        .patch(`/api/officers/${officerId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ accountStatus: "active" });
    assert.equal(reactivated.status, 200);
    const after = await request(app).get("/api/firs").set("Authorization", `Bearer ${token}`);
    assert.equal(after.status, 200, "reactivation restores access for the same token");
});
