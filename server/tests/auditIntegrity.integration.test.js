const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "audit-integrity-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const AuditLog = require("../models/AuditLog");
const auditService = require("../services/auditService");

let mongoServer;
let app;
let adminToken;
let officerToken;

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-audit-integrity"));
    app = createApp();
    const passwordHash = await bcrypt.hash("Audit@123", 10);
    const admin = await User.create({
        username: "integrity-admin",
        email: "integrity-admin@crms.test",
        passwordHash,
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    const officer = await User.create({
        username: "integrity-officer",
        email: "integrity-officer@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    await Officer.create({
        userId: officer._id,
        officerId: "INTEGRITY-OFF-1",
        badgeNumber: "INT001",
        name: "Integrity Officer",
        rank: "inspector",
        department: "Criminal Investigation",
        station: "Integrity Station",
        phoneNumber: "5550000000",
        address: "Test Street",
        joiningDate: "2020-01-01",
        status: "active",
    });
    const adminLogin = await request(app).post("/api/auth/login").send({ username: admin.username, password: "Audit@123" });
    const officerLogin = await request(app).post("/api/auth/login").send({ username: officer.username, password: "Audit@123" });
    assert.equal(adminLogin.status, 200);
    assert.equal(officerLogin.status, 200);
    adminToken = adminLogin.body.token;
    officerToken = officerLogin.body.token;
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("system administrators can verify a valid audit chain without sensitive details", async () => {
    const response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.valid, true);
    assert.ok(response.body.data.checkedRecords >= 2);
    assert.equal(Object.hasOwn(response.body.data, "connectionString"), false);
    assert.equal(Object.hasOwn(response.body.data, "database"), false);
});

test("concurrent audit writes preserve unique contiguous sequences and a valid chain", async () => {
    const writes = Array.from({ length: 12 }, (_, index) => auditService.log({
        actor: null,
        action: `CONCURRENT_AUDIT_${index}`,
        entityType: "Test",
        entityId: new mongoose.Types.ObjectId(),
        method: "TEST",
        path: "/test",
    }));
    await Promise.all(writes);

    const response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.valid, true);

    const protectedRecords = await AuditLog.find({ "integrity.sequence": { $exists: true } })
        .select("integrity.sequence")
        .sort({ "integrity.sequence": 1 })
        .lean();
    assert.equal(new Set(protectedRecords.map((record) => record.integrity.sequence)).size, protectedRecords.length);
    assert.deepEqual(
        protectedRecords.map((record) => record.integrity.sequence),
        Array.from({ length: protectedRecords.length }, (_, index) => index + 1),
    );
});

test("integrity verification binds hashes to sequence numbers", async () => {
    const record = await AuditLog.findOne({ "integrity.sequence": { $exists: true } })
        .sort({ "integrity.sequence": -1 })
        .lean();
    const originalSequence = record.integrity.sequence;
    await AuditLog.collection.updateOne(
        { _id: record._id },
        { $set: { "integrity.sequence": originalSequence + 100 } },
    );
    let response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", "Bearer " + adminToken)
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MISSING_OR_REORDERED_RECORD");
    await AuditLog.collection.updateOne(
        { _id: record._id },
        { $set: { "integrity.sequence": originalSequence } },
    );
});

test("integrity verification rejects malformed, missing-counter, and legacy classifications", async () => {
    const malformedId = new mongoose.Types.ObjectId();
    await AuditLog.collection.insertOne({
        _id: malformedId,
        action: "MALFORMED_TEST",
        entityType: "Test",
        occurredAt: new Date(),
        integrity: { sequence: 999 },
    });
    let response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", "Bearer " + adminToken)
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MALFORMED_INTEGRITY_RECORD");
    await AuditLog.collection.deleteOne({ _id: malformedId });

    await AuditLog.collection.insertOne({
        _id: new mongoose.Types.ObjectId(),
        action: "EMPTY_INTEGRITY_TEST",
        entityType: "Test",
        occurredAt: new Date(),
        integrity: {},
    });
    response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", "Bearer " + adminToken);
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MALFORMED_INTEGRITY_RECORD");
    await AuditLog.collection.deleteOne({ action: "EMPTY_INTEGRITY_TEST" });

    const sequence = await mongoose.model("AuditSequence").findById("audit-log").lean();
    await mongoose.model("AuditSequence").deleteOne({ _id: "audit-log" });
    response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", "Bearer " + adminToken)
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MISSING_SEQUENCE_COUNTER");
    await mongoose.model("AuditSequence").create(sequence);

    const legacyId = new mongoose.Types.ObjectId();
    await AuditLog.collection.insertOne({
        _id: legacyId,
        action: "LEGACY_TEST",
        entityType: "Test",
        occurredAt: new Date(),
    });
    response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", "Bearer " + adminToken)
    assert.equal(response.body.data.valid, true);
    assert.ok(response.body.data.legacyRecords >= 1);
    assert.equal(response.body.data.unprotectedRecords, response.body.data.legacyRecords);
    await AuditLog.collection.deleteOne({ _id: legacyId });
});

test("integrity verification detects modified and missing records", async () => {
    const first = await auditService.log({
        actor: null,
        action: "INTEGRITY_TEST_ONE",
        entityType: "Test",
        entityId: new mongoose.Types.ObjectId(),
        method: "TEST",
        path: "/test",
    });
    const second = await auditService.log({
        actor: null,
        action: "INTEGRITY_TEST_TWO",
        entityType: "Test",
        entityId: new mongoose.Types.ObjectId(),
        method: "TEST",
        path: "/test",
    });

    await AuditLog.collection.updateOne({ _id: first._id }, { $set: { action: "TAMPERED" } });
    let response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MODIFIED_RECORD");

    await AuditLog.collection.updateOne({ _id: first._id }, { $set: { action: first.action } });
    await AuditLog.collection.deleteOne({ _id: second._id });
    response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(response.body.data.valid, false);
    assert.equal(response.body.data.issue, "MISSING_OR_REORDERED_RECORD");
});

test("ordinary users cannot access audit integrity verification", async () => {
    const response = await request(app)
        .get("/api/audit/integrity")
        .set("Authorization", `Bearer ${officerToken}`);

    assert.equal(response.status, 403);
});
