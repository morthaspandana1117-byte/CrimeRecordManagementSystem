const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { mock } = require("node:test");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "evidence-upload-transactions-test-secret";
const evidenceStorageDirectory = path.join(os.tmpdir(), `crms-evidence-transactions-${process.pid}`);
process.env.EVIDENCE_STORAGE_DIR = evidenceStorageDirectory;

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const EvidenceCustodyHistory = require("../models/EvidenceCustodyHistory");
const CaseHistory = require("../models/CaseHistory");
const AuditLog = require("../models/AuditLog");
const evidenceFileService = require("../services/evidenceFileService");

let replSet;
let app;
let token;
let officer;
let caseRecord;

const evidenceBytes = Buffer.from("%PDF-1.7\nReplica set transaction evidence\n", "ascii");

const upload = (evidenceId) => request(app)
    .post("/api/evidence/with-file")
    .set("Authorization", `Bearer ${token}`)
    .field("evidenceId", evidenceId)
    .field("caseId", caseRecord._id.toString())
    .field("type", "Document")
    .field("description", "Replica set transaction test upload")
    .field("collectedBy", officer._id.toString())
    .field("collectionDate", "2026-10-12")
    .field("location", "Transaction Test Lane")
    .field("status", "Collected")
    .attach("file", evidenceBytes, { filename: "transaction.pdf", contentType: "application/pdf" });

const takeArtifactSnapshot = async () => ({
    evidence: await Evidence.countDocuments({ caseId: caseRecord._id }),
    custody: await EvidenceCustodyHistory.countDocuments({ caseId: caseRecord._id }),
    caseHistory: await CaseHistory.countDocuments({ caseId: caseRecord._id, actionType: "evidence_added" }),
    audit: await AuditLog.countDocuments({ entityType: "Evidence", action: "EVIDENCE_FILE_UPLOADED" }),
    files: await fs.readdir(evidenceStorageDirectory),
});

test.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri("crms-evidence-upload-transactions"));
    app = createApp();

    const user = await User.create({
        username: "evidence-transaction-officer",
        email: "evidence-transaction-officer@crms.test",
        passwordHash: await bcrypt.hash("Transaction@123", 10),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    officer = await Officer.create({
        userId: user._id,
        officerId: "TX-OFF-001",
        badgeNumber: "TX0001",
        name: "Transaction Officer",
        rank: "investigating_officer",
        department: "Criminal Investigation",
        station: "Transaction Station",
        phoneNumber: "9876543210",
        address: "Transaction Test Lane",
        joiningDate: "2020-01-01",
        status: "active",
    });
    const login = await request(app).post("/api/auth/login").send({
        username: "evidence-transaction-officer",
        password: "Transaction@123",
    });
    assert.equal(login.status, 200);
    token = login.body.token;

    const fir = await FIR.create({
        firNo: "FIR-EVIDENCE-TXN-001",
        date: "2026-10-01",
        policeStation: "Transaction Station",
        complaint: {
            complainantName: "Transaction Complainant",
            complainantPhone: "9876543210",
            complaintText: "Evidence upload transaction test.",
        },
        description: "Replica set evidence transaction test",
        crimeType: "Theft",
        location: { address: "Transaction Lane", city: "City A", state: "State A", pincode: "123456" },
        registeredBy: officer._id,
        criminalIds: [],
        status: "Open",
    });
    caseRecord = await Case.create({
        caseNo: "CASE-EVIDENCE-TXN-001",
        firId: fir._id,
        assignedOfficerIds: [officer._id],
        criminalIds: [],
        title: "Evidence transaction case",
        description: "Replica set transaction test case",
        startDate: "2026-10-01",
        location: "Transaction Lane",
        status: "Open",
        priority: "High",
        currentInvestigationRound: 1,
        investigationHistory: [{ round: 1, startedAt: "2026-10-01", status: "Open" }],
    });
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await replSet.stop();
    await fs.rm(evidenceStorageDirectory, { recursive: true, force: true });
});

test("evidence, custody, case history, and audit writes commit together on a replica set", async () => {
    const response = await upload("E-EVIDENCE-TXN-SUCCESS");
    assert.equal(response.status, 201);

    const record = await Evidence.findById(response.body.data._id).select("+storedFilename").lean();
    assert.ok(record);
    assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: record._id, action: "COLLECTED" }), 1);
    assert.equal(await CaseHistory.countDocuments({ caseId: caseRecord._id, actionType: "evidence_added", "newValue.evidenceId": record.evidenceId }), 1);
    assert.equal(await AuditLog.countDocuments({
        entityType: "Evidence",
        entityId: record._id,
        action: "EVIDENCE_FILE_UPLOADED",
    }), 1);
    assert.deepEqual(await fs.readFile(path.join(evidenceStorageDirectory, record.storedFilename)), evidenceBytes);
});

test("an uncertain withTransaction result preserves a file even if MongoDB committed it", async () => {
    const originalStartSession = mongoose.startSession;
    mock.method(mongoose, "startSession", async (...args) => {
        const session = await originalStartSession.apply(mongoose, args);
        session.withTransaction = async (callback) => {
            session.startTransaction();
            await callback(session);
            await session.commitTransaction();
            const error = new Error("simulated lost commit acknowledgement");
            error.hasErrorLabel = (label) => label === "UnknownTransactionCommitResult";
            throw error;
        };
        return session;
    });

    try {
        const response = await upload("E-EVIDENCE-TXN-UNKNOWN");
        assert.equal(response.status, 500);
        const record = await Evidence.findOne({ evidenceId: "E-EVIDENCE-TXN-UNKNOWN" }).select("+storedFilename").lean();
        assert.ok(record, "the simulated commit was persisted despite the lost acknowledgement");
        assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: record._id, action: "COLLECTED" }), 1);
        assert.equal(await CaseHistory.countDocuments({ caseId: caseRecord._id, actionType: "evidence_added", "newValue.evidenceId": record.evidenceId }), 1);
        assert.equal(await AuditLog.countDocuments({ entityId: record._id, entityType: "Evidence", action: "EVIDENCE_FILE_UPLOADED" }), 1);
        assert.deepEqual(await fs.readFile(path.join(evidenceStorageDirectory, record.storedFilename)), evidenceBytes);
    } finally {
        mongoose.startSession = originalStartSession;
    }
});

test("transaction rechecks case assignment after the file has been stored", async () => {
    const originalAssignment = caseRecord.assignedOfficerIds.map(String);
    const existingFiles = await fs.readdir(evidenceStorageDirectory);
    const originalSave = evidenceFileService.saveBuffer;
    mock.method(evidenceFileService, "saveBuffer", async (...args) => {
        const saved = await originalSave(...args);
        await Case.updateOne({ _id: caseRecord._id }, { $pull: { assignedOfficerIds: officer._id } });
        return saved;
    });

    try {
        const response = await upload("E-EVIDENCE-TXN-UNASSIGNED");
        assert.equal(response.status, 403);
        assert.equal(response.body.error, "CASE_ACCESS_DENIED");
        assert.equal(await Evidence.exists({ evidenceId: "E-EVIDENCE-TXN-UNASSIGNED" }), null);
        assert.deepEqual(await fs.readdir(evidenceStorageDirectory), existingFiles);
    } finally {
        evidenceFileService.saveBuffer = originalSave;
        await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: originalAssignment } });
    }
});

test("an audit write error aborts all transaction writes and removes the uploaded file", async () => {
    const baseline = await takeArtifactSnapshot();
    const originalCreate = AuditLog.create;
    mock.method(AuditLog, "create", async (...args) => {
        await originalCreate.apply(AuditLog, args);
        throw new Error("simulated post-insert audit failure");
    });

    try {
        const response = await upload("E-EVIDENCE-TXN-AUDIT-FAIL");
        assert.equal(response.status, 500);
        assert.equal(await Evidence.exists({ evidenceId: "E-EVIDENCE-TXN-AUDIT-FAIL" }), null);
        assert.deepEqual(await takeArtifactSnapshot(), baseline);
    } finally {
        AuditLog.create = originalCreate;
    }
});

test("topology detection failure rejects the request without standalone fallback or file storage", async () => {
    const baseline = await takeArtifactSnapshot();
    const originalAdmin = mongoose.connection.db.admin;
    mock.method(mongoose.connection.db, "admin", () => ({
        command: async () => { throw new Error("simulated temporary topology query failure"); },
    }));

    try {
        const response = await upload("E-EVIDENCE-TXN-TOPOLOGY-FAIL");
        assert.equal(response.status, 503);
        assert.equal(response.body.error, "DATABASE_TOPOLOGY_UNAVAILABLE");
        assert.equal(await Evidence.exists({ evidenceId: "E-EVIDENCE-TXN-TOPOLOGY-FAIL" }), null);
        assert.deepEqual(await takeArtifactSnapshot(), baseline);
    } finally {
        mongoose.connection.db.admin = originalAdmin;
    }
});
