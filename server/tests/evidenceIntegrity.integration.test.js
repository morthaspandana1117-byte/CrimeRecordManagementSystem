const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const request = require("supertest");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "evidence-integrity-test-secret";
const storage = path.join(os.tmpdir(), `crms-evidence-integrity-${process.pid}`);
process.env.EVIDENCE_STORAGE_DIR = storage;

const appFactory = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const AuditLog = require("../models/AuditLog");
const fileService = require("../services/evidenceFileService");

let replSet;
let app;
let caseRecord;
let tokens = {};
let officers = {};
const originalBytes = Buffer.from("private integrity evidence");
const alteredBytes = Buffer.from("changed private evidence");

const createEvidence = async (evidenceId, bytes = originalBytes, options = {}) => {
    const stored = options.noStoredFile ? null : await fileService.saveBuffer(bytes);
    return Evidence.create({
        evidenceId,
        caseId: caseRecord._id,
        investigationRound: 1,
        type: "Digital",
        description: "Integrity test record",
        collectedBy: officers.inspector._id,
        currentCustodian: officers.inspector._id,
        collectionDate: new Date("2026-10-01"),
        location: "Test",
        status: "Collected",
        ...(options.noHash ? {} : { fileHash: crypto.createHash("sha256").update(bytes).digest("hex") }),
        ...(stored ? { storedFilename: stored.storedFilename, fileSize: stored.fileSize } : {}),
    });
};

const check = (token, id) => request(app)
    .post(`/api/evidence/${id}/integrity-check`)
    .set("Authorization", `Bearer ${token}`);

test.before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri("crms-evidence-integrity"));
    app = appFactory();
    const passwordHash = await bcrypt.hash("Integrity@123", 10);
    let badgeIndex = 0;
    for (const rank of ["inspector", "dsp", "sp", "investigating_officer"]) {
        const username = `integrity-${rank}`;
        const user = await User.create({ username, email: `${username}@crms.test`, passwordHash, role: "officer", status: "approved", isActive: true });
        badgeIndex += 1;
        officers[rank] = await Officer.create({ userId: user._id, officerId: `INT-${rank}`, badgeNumber: `IN${String(badgeIndex).padStart(4, "0")}`, name: `Integrity ${rank}`, rank, department: "Criminal Investigation", station: "Integrity Station", phoneNumber: "5550000000", address: "Test", joiningDate: "2020-01-01", status: "active" });
        const login = await request(app).post("/api/auth/login").send({ username, password: "Integrity@123" });
        assert.equal(login.status, 200);
        tokens[rank] = login.body.token;
    }
    const admin = await User.create({ username: "integrity-admin", email: "integrity-admin@crms.test", passwordHash, role: "system_admin", status: "approved", isActive: true });
    const adminLogin = await request(app).post("/api/auth/login").send({ username: admin.username, password: "Integrity@123" });
    tokens.admin = adminLogin.body.token;
    const fir = await FIR.create({ firNo: "INT-FIR-1", date: "2026-10-01", policeStation: "Integrity Station", complaint: { complainantName: "Test", complainantPhone: "5550000000", complaintText: "Test" }, description: "Test", crimeType: "Theft", location: { address: "Test", city: "Test", state: "Test", pincode: "123456" }, registeredBy: officers.inspector._id, criminalIds: [], status: "Open" });
    caseRecord = await Case.create({ caseNo: "INT-CASE-1", firId: fir._id, assignedOfficerIds: Object.values(officers).map((officer) => officer._id), criminalIds: [], title: "Integrity case", description: "Test", startDate: "2026-10-01", location: "Test", status: "Open", priority: "High", currentInvestigationRound: 1, investigationHistory: [{ round: 1, startedAt: "2026-10-01", status: "Open" }] });
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await replSet.stop();
    await fs.rm(storage, { recursive: true, force: true });
});

test("integrity check returns intact and preserves original upload hash with safe response and audit", async () => {
    const evidence = await createEvidence("INTACT-1");
    const savedHash = evidence.fileHash;
    const response = await check(tokens.inspector, evidence._id);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { evidenceId: "INTACT-1", result: "intact" });
    assert.doesNotMatch(JSON.stringify(response.body), /storedFilename|private-evidence|[A-Z]:\\/i);
    assert.equal((await Evidence.findById(evidence._id)).fileHash, savedHash);
    const event = await AuditLog.findOne({ action: "EVIDENCE_INTEGRITY_CHECKED", entityId: evidence._id }).lean();
    assert.ok(event);
    assert.equal(String(event.actor), String((await User.findOne({ username: "integrity-inspector" }))._id));
    assert.equal(event.changes.after.integrityResult, "intact");
    assert.ok(event.occurredAt instanceof Date);
});

test("integrity check identifies modified and missing files, and safely handles absent hash metadata", async () => {
    const changed = await createEvidence("MODIFIED-1");
    await fs.writeFile(fileService.resolveStoredPath(changed.storedFilename), alteredBytes);
    const modified = await check(tokens.dsp, changed._id);
    assert.equal(modified.body.data.result, "modified");
    assert.equal((await Evidence.findById(changed._id)).fileHash, changed.fileHash);

    const absent = await createEvidence("MISSING-1");
    await fileService.deleteStoredFile(absent.storedFilename);
    assert.equal((await check(tokens.sp, absent._id)).body.data.result, "missing");
    const noFile = await createEvidence("NO-FILE-1", originalBytes, { noStoredFile: true });
    assert.equal((await check(tokens.inspector, noFile._id)).body.data.result, "missing");

    const noHash = await createEvidence("NO-HASH-1", originalBytes, { noHash: true });
    const noHashResponse = await check(tokens.inspector, noHash._id);
    assert.equal(noHashResponse.status, 409);
    assert.equal(noHashResponse.body.error, "EVIDENCE_HASH_UNAVAILABLE");
    assert.equal((await Evidence.findById(noHash._id)).fileHash, undefined);
});

test("only inspector, DSP, and SP can check integrity under the existing case-access policy", async () => {
    const evidence = await createEvidence("AUTH-1");
    for (const rank of ["inspector", "dsp", "sp"]) assert.equal((await check(tokens[rank], evidence._id)).status, 200);
    const lower = await check(tokens.investigating_officer, evidence._id);
    assert.equal(lower.status, 403);
    assert.equal(lower.body.error, "INSUFFICIENT_PERMISSIONS");
    const admin = await check(tokens.admin, evidence._id);
    assert.equal(admin.status, 403);

    const previous = caseRecord.assignedOfficerIds.map(String);
    await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: [] } });
    try {
        const seniorOfficerCaseAccess = await check(tokens.inspector, evidence._id);
        assert.equal(seniorOfficerCaseAccess.status, 200);
        assert.equal(seniorOfficerCaseAccess.body.data.result, "intact");
    } finally {
        await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: previous } });
    }
});

test("integrity check validates evidence IDs and reports absent evidence", async () => {
    assert.equal((await check(tokens.inspector, "bad-id")).body.error, "INVALID_EVIDENCE_ID");
    assert.equal((await check(tokens.inspector, "507f1f77bcf86cd799439011")).body.error, "EVIDENCE_NOT_FOUND");
});
