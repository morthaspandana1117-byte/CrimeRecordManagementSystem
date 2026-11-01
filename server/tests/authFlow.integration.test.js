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

let replSet;
let app;
let adminToken;

const registrationPayload = (overrides = {}) => ({
    username: "flow-officer",
    email: "Flow.Officer@crms.test",
    batchNumber: "FLW001",
    officerId: "FLOW-OFF-001",
    name: "Flow Officer",
    rank: "si",
    department: "Criminal Investigation",
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

    const approveAgain = await request(app)
        .patch(`/api/officers/${officer._id}/approve`)
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(approveAgain.status, 409);
    assert.equal(approveAgain.body.error, "OFFICER_NOT_PENDING");

    const approvedLogin = await login("flow-officer", payload.batchNumber);
    assert.equal(approvedLogin.status, 200);
    assert.equal(approvedLogin.body.user.systemRole, "officer");
    assert.equal(approvedLogin.body.user.rank, "investigating_officer");

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
