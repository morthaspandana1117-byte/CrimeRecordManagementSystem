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

const getHistory = (token, id, query = {}) => {
    const historyRequest = request(app).get(`/api/evidence/${id}/history`).query(query);
    return token ? historyRequest.set("Authorization", `Bearer ${token}`) : historyRequest;
};

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

test("evidence history validates IDs, requires authentication, and enforces existing case access", async () => {
    const evidence = await createEvidence("HISTORY-AUTH-1");
    assert.equal((await getHistory(tokens.inspector, "bad-id")).status, 400);
    const absent = await getHistory(tokens.inspector, "507f1f77bcf86cd799439011");
    assert.equal(absent.status, 404);
    assert.equal(absent.body.error, "EVIDENCE_NOT_FOUND");

    const unauthenticated = await getHistory(null, evidence._id);
    assert.equal(unauthenticated.status, 401);

    const originalAssignment = caseRecord.assignedOfficerIds.map(String);
    await Case.updateOne({ _id: caseRecord._id }, { $pull: { assignedOfficerIds: officers.investigating_officer._id } });
    try {
        const denied = await getHistory(tokens.investigating_officer, evidence._id);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error, "CASE_ACCESS_DENIED");
        assert.equal(Object.hasOwn(denied.body, "data"), false);
    } finally {
        await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: originalAssignment } });
    }
});

test("evidence history returns only safe events for that evidence, newest first, with actor rank and pagination", async () => {
    const evidence = await createEvidence("HISTORY-EVENTS-1");
    const unrelated = await createEvidence("HISTORY-OTHER-1");
    const occurredAt = (day) => new Date(Date.UTC(2026, 9, day));
    await AuditLog.create([
        { actor: officers.inspector.userId, action: "EVIDENCE_FILE_UPLOADED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(1), changes: { after: { caseId: caseRecord._id, status: "Collected", storedFilename: "private-file-uuid", fileHash: "sensitive-hash" } } },
        { actor: officers.dsp.userId, action: "EVIDENCE_FILE_DOWNLOADED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(2), changes: { after: { caseId: caseRecord._id, downloadOutcome: "completed", privatePath: "C:\\secret\\evidence" } } },
        { actor: officers.sp.userId, action: "EVIDENCE_FILE_DOWNLOAD_FAILED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(3), changes: { after: { downloadOutcome: "stream_interrupted", password: "never-return" } } },
        { actor: officers.inspector.userId, action: "EVIDENCE_VERIFIED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(4), changes: { before: { verificationStatus: "unverified" }, after: { status: "Verified", verificationStatus: "verified", verificationNotes: "not exposed" } } },
        { actor: officers.dsp.userId, action: "EVIDENCE_REJECTED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(5), changes: { before: { verificationStatus: "verified" }, after: { verificationStatus: "rejected" } } },
        { actor: officers.sp.userId, action: "EVIDENCE_INTEGRITY_CHECKED", entityType: "Evidence", entityId: evidence._id, occurredAt: occurredAt(6), changes: { after: { integrityResult: "modified", storedFilename: "private-file-uuid" } } },
        { actor: officers.inspector.userId, action: "EVIDENCE_FILE_UPLOADED", entityType: "Evidence", entityId: unrelated._id, occurredAt: occurredAt(7), changes: { after: { status: "Collected" } } },
    ]);

    const firstPage = await getHistory(tokens.inspector, evidence._id, { page: 1, limit: 2 });
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.body.data.map((event) => event.action), ["EVIDENCE_INTEGRITY_CHECKED", "EVIDENCE_REJECTED"]);
    assert.deepEqual(firstPage.body.pagination, { page: 1, limit: 2, totalRecords: 6, totalPages: 3 });
    assert.equal(firstPage.body.data[0].actor.username, "integrity-sp");
    assert.equal(firstPage.body.data[0].actor.rank, "sp");
    assert.equal(firstPage.body.data[0].details.integrityResult, "modified");
    assert.equal(Object.hasOwn(firstPage.body.data[0], "changes"), false);

    const secondPage = await getHistory(tokens.inspector, evidence._id, { page: 2, limit: 2 });
    assert.deepEqual(secondPage.body.data.map((event) => event.action), ["EVIDENCE_VERIFIED", "EVIDENCE_FILE_DOWNLOAD_FAILED"]);
    assert.equal(secondPage.body.data[1].details.downloadOutcome, "stream_interrupted");
    const thirdPage = await getHistory(tokens.inspector, evidence._id, { page: 3, limit: 2 });
    assert.deepEqual(thirdPage.body.data.map((event) => event.action), ["EVIDENCE_FILE_DOWNLOADED", "EVIDENCE_FILE_UPLOADED"]);
    assert.equal(thirdPage.body.data[1].details.status, "Collected");

    const serialized = JSON.stringify([firstPage.body, secondPage.body, thirdPage.body]);
    assert.doesNotMatch(serialized, /storedFilename|private-file-uuid|C:\\\\secret|sensitive-hash|never-return|not exposed|verificationNotes|privatePath|fileHash/);
    const invalidPagination = await getHistory(tokens.inspector, evidence._id, { page: 0, limit: 101 });
    assert.equal(invalidPagination.status, 400);
    assert.equal(invalidPagination.body.error, "INVALID_PAGINATION");
    for (const query of [
        { page: "2abc" },
        { page: "1.5" },
        { limit: "50xyz" },
        { limit: "2.5" },
    ]) {
        const malformedPagination = await getHistory(tokens.inspector, evidence._id, query);
        assert.equal(malformedPagination.status, 400, `expected malformed pagination to be rejected: ${JSON.stringify(query)}`);
        assert.equal(malformedPagination.body.error, "INVALID_PAGINATION");
    }
});

test("evidence with no audit events returns an empty paginated history", async () => {
    const evidence = await createEvidence("HISTORY-EMPTY-1");
    const response = await getHistory(tokens.inspector, evidence._id);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.deepEqual(response.body.pagination, { page: 1, limit: 50, totalRecords: 0, totalPages: 1 });
});
