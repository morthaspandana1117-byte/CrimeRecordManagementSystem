const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "audit-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const AuditLog = require("../models/AuditLog");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const EvidenceCustodyHistory = require("../models/EvidenceCustodyHistory");

let mongoServer;
let app;
let adminToken;
let officerToken;
let admin;
let officerUserId;
let officer;

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri("crms-audit");
    if (!mongoUri.startsWith("mongodb://127.0.0.1") && !mongoUri.startsWith("mongodb://localhost")) {
        throw new Error("Audit test did not receive an isolated MongoDB URI");
    }
    await mongoose.connect(mongoUri);
    app = createApp();
    const passwordHash = await bcrypt.hash("Audit@123", 10);
    admin = await User.create({ username: "audit-admin", email: "audit-admin@crms.test", passwordHash, role: "system_admin", status: "approved", isActive: true });
    const officerUser = await User.create({ username: "audit-officer", email: "audit-officer@crms.test", passwordHash, role: "officer", status: "approved", isActive: true });
    officerUserId = officerUser._id.toString();
    officer = await Officer.create({ userId: officerUser._id, officerId: "AUDIT-OFF-1", badgeNumber: "AUD001", name: "Audit Officer", rank: "inspector", department: "Criminal Investigation", station: "Audit Station", phoneNumber: "5550000000", address: "Test Street", joiningDate: "2020-01-01", status: "active" });

    const adminLogin = await request(app).post("/api/auth/login").send({ username: admin.username, password: "Audit@123" });
    const officerLogin = await request(app).post("/api/auth/login").send({ username: officerUser.username, password: "Audit@123" });
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

test("authorized admin can read scoped audit records; ordinary officers cannot", async () => {
    const response = await request(app)
        .post("/api/criminals")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ criminalId: "AUD-CRIM-1", fullName: "Audit Test", dateOfBirth: "1990-01-01", gender: "Other", address: "Test", status: "active", actor: new mongoose.Types.ObjectId().toString() });
    assert.equal(response.status, 201);
    const created = await Criminal.findOne({ criminalId: "AUD-CRIM-1" });

    const auditResponse = await request(app).get("/api/audit").set("Authorization", `Bearer ${adminToken}`).query({ entityType: "Criminal", entityId: created._id.toString(), action: "CRIMINAL_CREATED" });
    assert.equal(auditResponse.status, 200);
    const event = auditResponse.body.data.find((item) => item.action === "CRIMINAL_CREATED");
    assert.ok(event);
    assert.equal(event.actor._id, officerUserId);
    assert.equal(event.entityType, "Criminal");
    assert.equal(event.entityId, created._id.toString());
    assert.ok(Math.abs(Date.now() - new Date(event.occurredAt).getTime()) < 10000);
    assert.equal(event.changes.after.fullName, "Audit Test");
    assert.equal(JSON.stringify(event).includes(adminToken), false);

    const denied = await request(app).get("/api/audit").set("Authorization", `Bearer ${officerToken}`);
    assert.equal(denied.status, 403);
});

test("updates retain safe before and after values; audit API is read-only", async () => {
    const criminal = await Criminal.findOne({ criminalId: "AUD-CRIM-1" });
    const response = await request(app)
        .put(`/api/criminals/${criminal._id}`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ status: "wanted", password: "never-audit-this" });
    assert.equal(response.status, 200);

    const event = await AuditLog.findOne({ entityId: criminal._id, action: "CRIMINAL_UPDATED" }).lean();
    assert.equal(event.changes.before.status, "active");
    assert.equal(event.changes.after.status, "wanted");
    assert.equal(JSON.stringify(event).includes("never-audit-this"), false);

    for (const [method, url] of [
        ["post", "/api/audit"],
        ["put", `/api/audit/${event._id}`],
        ["patch", `/api/audit/${event._id}`],
        ["delete", `/api/audit/${event._id}`],
    ]) {
        const attempt = await request(app)[method](url).set("Authorization", `Bearer ${adminToken}`).send({ action: "SPOOFED" });
        assert.equal(attempt.status, 404);
    }
    await assert.rejects(AuditLog.updateOne({ _id: event._id }, { $set: { action: "TAMPERED" } }), /append-only/);
    await assert.rejects(AuditLog.deleteOne({ _id: event._id }), /append-only/);
});

test("authentication audit events contain no credential or token values", async () => {
    const authEvents = await AuditLog.find({ entityType: "Authentication" }).lean();
    assert.ok(authEvents.some((item) => item.action === "LOGIN_SUCCEEDED"));
    const serialized = JSON.stringify(authEvents);
    assert.equal(serialized.includes("Audit@123"), false);
    assert.equal(serialized.includes(adminToken), false);
});

test("evidence verification creates an audit event with safe before and after status", async () => {
    const caseRecord = await Case.create({
        caseNo: "AUD-CASE-1",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [officer._id],
        criminalIds: [new mongoose.Types.ObjectId()],
        title: "Audit test case",
        description: "Audit test case",
        startDate: "2026-01-01",
        status: "Open",
        priority: "Medium",
        currentInvestigationRound: 1,
        investigationHistory: [{ round: 1, startedAt: "2026-01-01", startedBy: new mongoose.Types.ObjectId(), status: "Open" }],
    });
    const created = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ evidenceId: "AUD-EVD-1", caseId: caseRecord._id.toString(), type: "Physical", description: "Evidence for audit", collectedBy: officer._id.toString(), collectionDate: "2026-01-02", location: "Test location", status: "Collected" });
    assert.equal(created.status, 201);

    const verified = await request(app)
        .patch(`/api/evidence/${created.body.data._id}/verify`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ verificationStatus: "verified" });
    assert.equal(verified.status, 200);
    const event = await AuditLog.findOne({ action: "EVIDENCE_VERIFIED", entityId: created.body.data._id }).lean();
    assert.ok(event);
    assert.equal(event.actor.toString(), officerUserId);
    assert.equal(event.changes.before.status, "Collected");
    assert.equal(event.changes.after.status, "Verified");
    assert.equal(event.changes.before.verificationStatus, "unverified");
    assert.equal(event.changes.after.verificationStatus, "verified");
    assert.ok(await Evidence.findById(created.body.data._id));
});

test("evidence rejection audit records verificationStatus before and after", async () => {
    const caseRecord = await Case.create({
        caseNo: "AUD-REJECT-CASE-1",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [officer._id],
        criminalIds: [new mongoose.Types.ObjectId()],
        title: "Audit rejection case",
        description: "Audit rejection case",
        startDate: "2026-01-01",
        status: "Open",
        priority: "Medium",
        currentInvestigationRound: 1,
        investigationHistory: [{ round: 1, startedAt: "2026-01-01", startedBy: new mongoose.Types.ObjectId(), status: "Open" }],
    });
    const created = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ evidenceId: "AUD-EVD-REJECT-1", caseId: caseRecord._id.toString(), type: "Physical", description: "Evidence for rejection audit", collectedBy: officer._id.toString(), collectionDate: "2026-01-02", location: "Test location", status: "Collected" });
    assert.equal(created.status, 201);

    const rejected = await request(app)
        .patch(`/api/evidence/${created.body.data._id}/verify`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ verificationStatus: "rejected", verificationNotes: "Does not match" });
    assert.equal(rejected.status, 200);
    const event = await AuditLog.findOne({ action: "EVIDENCE_REJECTED", entityId: created.body.data._id }).lean();
    assert.ok(event);
    assert.equal(event.changes.before.verificationStatus, "unverified");
    assert.equal(event.changes.after.verificationStatus, "rejected");
});

test("custody transfer audit records a distinct action and safe custodian transition", async () => {
    const targetUser = await User.create({ username: "audit-custody-target", email: "audit-custody-target@crms.test", passwordHash: await bcrypt.hash("Audit@123", 10), role: "officer", status: "approved", isActive: true });
    const targetOfficer = await Officer.create({ userId: targetUser._id, officerId: "AUDIT-OFF-2", badgeNumber: "AUD002", name: "Custody Target", rank: "dsp", department: "Criminal Investigation", station: "Audit Station", phoneNumber: "5550000001", address: "Test Street", joiningDate: "2020-01-01", status: "active" });
    const caseRecord = await Case.create({
        caseNo: "AUD-CUSTODY-CASE-1",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [officer._id, targetOfficer._id],
        criminalIds: [new mongoose.Types.ObjectId()],
        title: "Audit custody case",
        description: "Audit custody case",
        startDate: "2026-01-01",
        status: "Open",
        priority: "Medium",
        currentInvestigationRound: 1,
        investigationHistory: [{ round: 1, startedAt: "2026-01-01", startedBy: new mongoose.Types.ObjectId(), status: "Open" }],
    });
    const created = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ evidenceId: "AUD-EVD-CUSTODY-1", caseId: caseRecord._id.toString(), type: "Physical", description: "Evidence for custody audit", collectedBy: officer._id.toString(), collectionDate: "2026-01-02", location: "Test location", status: "Collected" });
    assert.equal(created.status, 201);

    const transfer = await request(app)
        .post(`/api/evidence/${created.body.data._id}/custody/transfer`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ toOfficerId: targetOfficer._id.toString(), remarks: "Transfer for audit test" });
    assert.equal(transfer.status, 200);

    const event = await AuditLog.findOne({ entityType: "Evidence", entityId: created.body.data._id, action: "EVIDENCE_CUSTODY_TRANSFERRED" }).lean();
    assert.ok(event);
    assert.equal(event.actor.toString(), officerUserId);
    assert.equal(event.changes.before.currentCustodian, officer._id.toString());
    assert.equal(event.changes.after.currentCustodian, targetOfficer._id.toString());
    assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: created.body.data._id, action: "EVIDENCE_CREATED" }), 1);

    const custodyTransfer = await EvidenceCustodyHistory.findOne({ evidenceId: created.body.data._id, action: "TRANSFERRED" }).lean();
    assert.ok(custodyTransfer);
    assert.equal(custodyTransfer.toCustodian.toString(), targetOfficer._id.toString());
});
