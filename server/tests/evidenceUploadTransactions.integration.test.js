const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const http = require("node:http");
const { Readable } = require("node:stream");
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
const auditService = require("../services/auditService");

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

const waitForAudit = async (filter) => {
    for (let attempt = 0; attempt < 30; attempt++) {
        const record = await AuditLog.findOne(filter).lean();
        if (record) return record;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return null;
};

const waitForDownloadResponse = async (evidenceId, { abortOnData = false } = {}) => {
    const server = app.listen(0);
    try {
        const address = server.address();
        return await new Promise((resolve, reject) => {
            const client = http.get({
                hostname: "127.0.0.1",
                port: address.port,
                path: `/api/evidence/${evidenceId}/download`,
                headers: { Authorization: `Bearer ${token}` },
            }, (response) => {
                let aborted = false;
                const chunks = [];
                response.on("data", (chunk) => {
                    chunks.push(chunk);
                    if (abortOnData && !aborted) {
                        aborted = true;
                        response.destroy();
                    }
                });
                response.once("aborted", () => resolve({ status: response.statusCode, aborted: true, body: Buffer.concat(chunks) }));
                response.once("end", () => resolve({ status: response.statusCode, aborted: false, body: Buffer.concat(chunks) }));
                response.once("error", reject);
            });
            client.on("error", (error) => {
                if (error.code !== "ECONNRESET") reject(error);
            });
        });
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

const countDownloadEvents = (evidenceId) => AuditLog.countDocuments({
    entityType: "Evidence",
    entityId: evidenceId,
    action: { $in: ["EVIDENCE_FILE_DOWNLOADED", "EVIDENCE_FILE_DOWNLOAD_FAILED"] },
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

let custodyFixtureSequence = 0;
const createCustodyFixture = async (suffix) => {
    const user = await User.create({
        username: `custody-receiver-${suffix}`,
        email: `custody-receiver-${suffix}@crms.test`,
        passwordHash: await bcrypt.hash("Custody@123", 10),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const receiver = await Officer.create({
        userId: user._id,
        officerId: `CUSTODY-${suffix}`,
        badgeNumber: `C${String(++custodyFixtureSequence).padStart(5, "0")}`,
        name: `Custody Receiver ${suffix}`,
        rank: "investigating_officer",
        department: "Criminal Investigation",
        station: "Transaction Station",
        phoneNumber: "9876543211",
        address: "Transaction Test Lane",
        joiningDate: "2020-01-01",
        status: "active",
    });
    await Case.updateOne({ _id: caseRecord._id }, { $addToSet: { assignedOfficerIds: receiver._id } });
    const evidence = await Evidence.create({
        evidenceId: `E-CUSTODY-${suffix}`,
        caseId: caseRecord._id,
        investigationRound: 1,
        type: "Document",
        description: "Receiver acknowledgement custody test",
        collectedBy: officer._id,
        currentCustodian: officer._id,
        collectionDate: "2026-10-12",
        location: "Transaction Test Lane",
        status: "Collected",
    });
    const login = await request(app).post("/api/auth/login").send({ username: user.username, password: "Custody@123" });
    assert.equal(login.status, 200);
    return { evidence, receiver, receiverToken: login.body.token };
};

const createAssignedOfficer = async (suffix, rank = "investigating_officer") => {
    const user = await User.create({
        username: `custody-race-${suffix}`,
        email: `custody-race-${suffix}@crms.test`,
        passwordHash: await bcrypt.hash("Custody@123", 10),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const assignedOfficer = await Officer.create({
        userId: user._id,
        officerId: `CUSTODY-RACE-${suffix}`,
        badgeNumber: `R${String(++custodyFixtureSequence).padStart(5, "0")}`,
        name: `Custody Race ${suffix}`,
        rank,
        department: "Criminal Investigation",
        station: "Transaction Station",
        phoneNumber: "9876543213",
        address: "Transaction Test Lane",
        joiningDate: "2020-01-01",
        status: "active",
    });
    await Case.updateOne({ _id: caseRecord._id }, { $addToSet: { assignedOfficerIds: assignedOfficer._id } });
    const login = await request(app).post("/api/auth/login").send({ username: user.username, password: "Custody@123" });
    assert.equal(login.status, 200);
    return { officer: assignedOfficer, token: login.body.token };
};

const changeCustodianAfterInitialRead = (evidenceId, nextCustodianId) => {
    const originalFindById = Evidence.findById;
    const originalUpdateOne = Evidence.updateOne;
    let changed = false;
    Evidence.findById = function (id, ...args) {
        const query = originalFindById.call(this, id, ...args);
        if (changed || String(id) !== String(evidenceId)) return query;
        changed = true;
        const originalThen = query.then.bind(query);
        query.then = (resolve, reject) => originalThen(async (document) => {
            await originalUpdateOne.call(Evidence, { _id: evidenceId }, { $set: { currentCustodian: nextCustodianId } });
            return resolve(document);
        }, reject);
        return query;
    };
    return () => { Evidence.findById = originalFindById; };
};

test("custody initiation revalidates sender and receiver against transactional evidence state", async () => {
    const assertNoInitiationWrites = async (evidenceId) => {
        assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId, action: "TRANSFER_INITIATED" }), 0);
        assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidenceId, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 0);
        const saved = await Evidence.findById(evidenceId).lean();
        assert.equal(saved.pendingCustodyTransfer, undefined);
    };

    const former = await createCustodyFixture("RACEFORMER");
    const replacementCustodian = await createAssignedOfficer("RACEFORMER-CURRENT");
    let restore = changeCustodianAfterInitialRead(former.evidence._id, replacementCustodian.officer._id);
    try {
        const response = await request(app).post(`/api/evidence/${former.evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: former.receiver._id });
        assert.equal(response.status, 403);
        assert.equal(response.body.error, "CUSTODY_TRANSFER_NOT_ALLOWED");
        await assertNoInitiationWrites(former.evidence._id);
        assert.equal((await Evidence.findById(former.evidence._id).lean()).currentCustodian.toString(), replacementCustodian.officer._id.toString());
    } finally {
        restore();
    }

    const senior = await createCustodyFixture("RACESENIOR");
    const seniorOfficer = await createAssignedOfficer("RACESENIOR-ACTOR", "inspector");
    const changedCustodian = await createAssignedOfficer("RACESENIOR-CURRENT");
    restore = changeCustodianAfterInitialRead(senior.evidence._id, changedCustodian.officer._id);
    try {
        const response = await request(app).post(`/api/evidence/${senior.evidence._id}/custody/transfers`).set("Authorization", `Bearer ${seniorOfficer.token}`).send({ toOfficerId: senior.receiver._id });
        assert.equal(response.status, 200);
        const saved = await Evidence.findById(senior.evidence._id).lean();
        assert.equal(saved.currentCustodian.toString(), changedCustodian.officer._id.toString());
        assert.ok(saved.pendingCustodyTransfer);
        assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: senior.evidence._id, action: "TRANSFER_INITIATED" }), 1);
        assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: senior.evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 1);
    } finally {
        restore();
    }

    const receiverNowCustodian = await createCustodyFixture("RACERECEIVER");
    const seniorForRedundantCheck = await createAssignedOfficer("RACERECEIVER-SENIOR", "inspector");
    restore = changeCustodianAfterInitialRead(receiverNowCustodian.evidence._id, receiverNowCustodian.receiver._id);
    try {
        const response = await request(app).post(`/api/evidence/${receiverNowCustodian.evidence._id}/custody/transfers`).set("Authorization", `Bearer ${seniorForRedundantCheck.token}`).send({ toOfficerId: receiverNowCustodian.receiver._id });
        assert.equal(response.status, 409);
        assert.equal(response.body.error, "CUSTODY_TRANSFER_REDUNDANT");
        await assertNoInitiationWrites(receiverNowCustodian.evidence._id);
        assert.equal((await Evidence.findById(receiverNowCustodian.evidence._id).lean()).currentCustodian.toString(), receiverNowCustodian.receiver._id.toString());
    } finally {
        restore();
    }
});

test("receiver acknowledgement is identity-bound, concurrent-safe, and audited once per committed transition", async () => {
    const { evidence, receiver, receiverToken } = await createCustodyFixture("CONCURRENT");
    const outsiderUser = await User.create({ username: "custody-outsider", email: "custody-outsider@crms.test", passwordHash: await bcrypt.hash("Custody@123", 10), role: "officer", status: "approved", isActive: true });
    await Officer.create({ userId: outsiderUser._id, officerId: "CUSTODY-OUTSIDER", badgeNumber: "COUT01", name: "Custody Outsider", rank: "investigating_officer", department: "Criminal Investigation", station: "Transaction Station", phoneNumber: "9876543212", address: "Transaction Test Lane", joiningDate: "2020-01-01", status: "active" });
    const outsiderLogin = await request(app).post("/api/auth/login").send({ username: outsiderUser.username, password: "Custody@123" });
    assert.equal(outsiderLogin.status, 200);
    const outsiderInit = await request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${outsiderLogin.body.token}`).send({ toOfficerId: receiver._id });
    assert.equal(outsiderInit.status, 403);
    const outsiderPending = await request(app).get(`/api/evidence/${evidence._id}/custody/pending`).set("Authorization", `Bearer ${outsiderLogin.body.token}`);
    assert.equal(outsiderPending.status, 403);
    const initiations = await Promise.all([
        request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: receiver._id, remarks: "Transfer" }),
        request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: receiver._id, remarks: "Transfer" }),
    ]);
    assert.equal(initiations.filter((response) => response.status === 200).length, 1);
    assert.equal(initiations.filter((response) => response.status === 409).length, 1);
    const initiation = initiations.find((response) => response.status === 200);
    const storedPending = await Evidence.findById(evidence._id).lean();
    assert.equal(storedPending.currentCustodian.toString(), officer._id.toString());
    assert.equal(storedPending.pendingCustodyTransfer.toCustodian.toString(), receiver._id.toString());
    assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFER_INITIATED" }), 1);

    const pending = await request(app).get(`/api/evidence/${evidence._id}/custody/pending`).set("Authorization", `Bearer ${token}`);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.data.toCustodian._id.toString(), receiver._id.toString());
    assert.equal(pending.body.data.initiatedAt, initiation.body.data.pendingTransfer.initiatedAt);
    assert.equal(Object.hasOwn(pending.body.data, "storedFilename"), false);

    const senderAck = await request(app)
        .post(`/api/evidence/${evidence._id}/custody/transfers/${initiation.body.data.pendingTransfer.transferId}/acknowledge`)
        .set("Authorization", `Bearer ${token}`);
    assert.equal(senderAck.status, 403);
    const outsiderAck = await request(app)
        .post(`/api/evidence/${evidence._id}/custody/transfers/${initiation.body.data.pendingTransfer.transferId}/acknowledge`)
        .set("Authorization", `Bearer ${outsiderLogin.body.token}`);
    assert.equal(outsiderAck.status, 403);
    const acknowledgements = await Promise.all([
        request(app).post(`/api/evidence/${evidence._id}/custody/transfers/${initiation.body.data.pendingTransfer.transferId}/acknowledge`).set("Authorization", `Bearer ${receiverToken}`),
        request(app).post(`/api/evidence/${evidence._id}/custody/transfers/${initiation.body.data.pendingTransfer.transferId}/acknowledge`).set("Authorization", `Bearer ${receiverToken}`),
    ]);
    assert.equal(acknowledgements.filter((response) => response.status === 200).length, 1);
    assert.equal(acknowledgements.filter((response) => response.status === 409).length, 1);
    const completed = await Evidence.findById(evidence._id).lean();
    assert.equal(completed.currentCustodian.toString(), receiver._id.toString());
    assert.equal(completed.pendingCustodyTransfer, undefined);
    assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFERRED", transferId: initiation.body.data.pendingTransfer.transferId }), 1);
    assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 1);
    assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_ACKNOWLEDGED" }), 1);
});

test("custody transactions roll back pending state, history, evidence, and audit writes on failures", async () => {
    const assertCleanInitiationFailure = async (suffix, model, method, failure) => {
        const { evidence, receiver } = await createCustodyFixture(suffix);
        const original = model[method];
        mock.method(model, method, async (...args) => {
            if (failure(args)) throw new Error(`simulated ${suffix} failure`);
            return original.apply(model, args);
        });
        try {
            const response = await request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: receiver._id });
            assert.equal(response.status, 500);
            const saved = await Evidence.findById(evidence._id).lean();
            assert.equal(saved.pendingCustodyTransfer, undefined);
            assert.equal(saved.currentCustodian.toString(), officer._id.toString());
            assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFER_INITIATED" }), 0);
            assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 0);
        } finally {
            model[method] = original;
        }
    };
    await assertCleanInitiationFailure("HISTORYFAIL", EvidenceCustodyHistory, "create", () => true);
    await assertCleanInitiationFailure("EVIDENCEFAIL", Evidence, "updateOne", () => true);
    await assertCleanInitiationFailure("AUDITFAIL", AuditLog, "create", () => true);

    const assertCleanAcknowledgementFailure = async (suffix, model, method) => {
        const { evidence, receiver, receiverToken } = await createCustodyFixture(suffix);
        const initiated = await request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: receiver._id });
        assert.equal(initiated.status, 200);
        const original = model[method];
        mock.method(model, method, async () => { throw new Error(`simulated ${suffix} failure`); });
        try {
            const response = await request(app)
                .post(`/api/evidence/${evidence._id}/custody/transfers/${initiated.body.data.pendingTransfer.transferId}/acknowledge`)
                .set("Authorization", `Bearer ${receiverToken}`);
            assert.equal(response.status, 500);
            const saved = await Evidence.findById(evidence._id).lean();
            assert.equal(saved.currentCustodian.toString(), officer._id.toString());
            assert.equal(saved.pendingCustodyTransfer.toCustodian.toString(), receiver._id.toString());
            assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFERRED" }), 0);
            assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_ACKNOWLEDGED" }), 0);
        } finally {
            model[method] = original;
        }
    };
    await assertCleanAcknowledgementFailure("ACKHISTORYFAIL", EvidenceCustodyHistory, "create");
    await assertCleanAcknowledgementFailure("ACKEVIDENCEFAIL", Evidence, "updateOne");
    await assertCleanAcknowledgementFailure("ACKAUDITFAIL", AuditLog, "create");
});

test("custody endpoints reject client-supplied actor identities and timestamps", async () => {
    const { evidence, receiver } = await createCustodyFixture("METADATA");
    for (const field of ["performedBy", "performedByOfficer", "timestamp", "createdAt", "updatedAt"]) {
        const response = await request(app)
            .post(`/api/evidence/${evidence._id}/custody/transfers`)
            .set("Authorization", `Bearer ${token}`)
            .send({ toOfficerId: receiver._id, [field]: new mongoose.Types.ObjectId().toString() });
        assert.equal(response.status, 400, field);
    }
    assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFER_INITIATED" }), 0);
    assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 0);

    const initiated = await request(app).post(`/api/evidence/${evidence._id}/custody/transfers`).set("Authorization", `Bearer ${token}`).send({ toOfficerId: receiver._id });
    assert.equal(initiated.status, 200);
    const receiverLogin = await request(app).post("/api/auth/login").send({ username: `custody-receiver-METADATA`, password: "Custody@123" });
    assert.equal(receiverLogin.status, 200);
    for (const field of ["performedBy", "performedByOfficer", "timestamp", "createdAt", "updatedAt"]) {
        const response = await request(app)
            .post(`/api/evidence/${evidence._id}/custody/transfers/${initiated.body.data.pendingTransfer.transferId}/acknowledge`)
            .set("Authorization", `Bearer ${receiverLogin.body.token}`)
            .send({ [field]: new mongoose.Types.ObjectId().toString() });
        assert.equal(response.status, 400, field);
    }
    const stillPending = await Evidence.findById(evidence._id).lean();
    assert.ok(stillPending.pendingCustodyTransfer);
    assert.equal(stillPending.currentCustodian.toString(), officer._id.toString());
});

test("custody transitions fail safely without transaction-capable MongoDB topology", async () => {
    const { evidence, receiver } = await createCustodyFixture("NOTXN");
    const database = mongoose.connection.db;
    const originalAdmin = database.admin;
    database.admin = () => ({ command: async () => ({ ok: 1 }) });
    try {
        const initiation = await request(app)
            .post(`/api/evidence/${evidence._id}/custody/transfers`)
            .set("Authorization", `Bearer ${token}`)
            .send({ toOfficerId: receiver._id });
        assert.equal(initiation.status, 503);
        assert.equal(initiation.body.error, "CUSTODY_TRANSACTIONS_UNAVAILABLE");
        const stored = await Evidence.findById(evidence._id).lean();
        assert.equal(stored.pendingCustodyTransfer, undefined);
        assert.equal(await EvidenceCustodyHistory.countDocuments({ evidenceId: evidence._id, action: "TRANSFER_INITIATED" }), 0);
        assert.equal(await AuditLog.countDocuments({ entityType: "Evidence", entityId: evidence._id, action: "EVIDENCE_CUSTODY_TRANSFER_INITIATED" }), 0);
    } finally {
        database.admin = originalAdmin;
    }
});

test("evidence, custody, case history, and audit writes commit together on a replica set", async () => {
    const response = await upload("E-EVIDENCE-TXN-SUCCESS");
    assert.equal(response.status, 201);
    assert.equal(response.body.data.hasFile, true);
    assert.equal(Object.hasOwn(response.body.data, "storedFilename"), false);

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

    const listed = await request(app)
        .get(`/api/evidence?caseId=${caseRecord._id}&search=E-EVIDENCE-TXN-SUCCESS`)
        .set("Authorization", `Bearer ${token}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.find((item) => item._id === record._id.toString()).hasFile, true);
    assert.equal(Object.hasOwn(listed.body.data[0], "storedFilename"), false);
});

test("JSON evidence creation remains available and reports no private attachment", async () => {
    const response = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${token}`)
        .send({
            evidenceId: "E-EVIDENCE-JSON-ONLY",
            caseId: caseRecord._id.toString(),
            type: "Document",
            description: "Evidence created without an attachment",
            collectedBy: officer._id.toString(),
            collectionDate: "2026-10-12",
            location: "Transaction Test Lane",
            status: "Collected",
        });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.hasFile, false);
    assert.equal(Object.hasOwn(response.body.data, "storedFilename"), false);
});

test("authorized evidence downloads stream private bytes with safe headers", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD");
    assert.equal(uploaded.status, 201);
    const record = await Evidence.findById(uploaded.body.data._id).select("+storedFilename");
    record.fileName = '../private\r\nX-Evil: yes.pdf';
    await record.save();

    const response = await request(app)
        .get(`/api/evidence/${record._id}/download`)
        .set("Authorization", `Bearer ${token}`)
        .buffer(true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, evidenceBytes);
    assert.equal(response.headers["content-type"], "application/pdf");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.match(response.headers["content-disposition"], /^attachment; filename=/);
    assert.doesNotMatch(response.headers["content-disposition"], /[\r\n/\\]/);
    assert.doesNotMatch(response.text || "", new RegExp(evidenceStorageDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const auditFilter = { entityType: "Evidence", entityId: record._id, action: "EVIDENCE_FILE_DOWNLOADED" };
    const audit = await waitForAudit(auditFilter);
    assert.ok(audit);
    assert.equal(await AuditLog.countDocuments(auditFilter), 1);
    assert.equal(String(audit.actor), String(officer.userId));
    assert.equal(audit.changes.after.caseId, caseRecord._id.toString());
    assert.equal(audit.changes.after.downloadOutcome, "completed");
    assert.equal(audit.metadata.method, "GET");
    assert.match(audit.metadata.path, /\/api\/evidence\/.+\/download$/);
    assert.ok(Math.abs(Date.now() - audit.occurredAt.getTime()) < 10000);
    assert.doesNotMatch(JSON.stringify(audit), /storedFilename|private-evidence|[A-Z]:\\/i);
    assert.equal(await countDownloadEvents(record._id), 1, "finish and close around a completed response must not duplicate the audit event");
});

test("evidence download rejects unauthenticated and unassigned requests", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-AUTH");
    const unauthenticated = await request(app).get(`/api/evidence/${uploaded.body.data._id}/download`);
    assert.equal(unauthenticated.status, 401);

    const originalAssignment = caseRecord.assignedOfficerIds.map(String);
    await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: [] } });
    try {
        const denied = await request(app)
            .get(`/api/evidence/${uploaded.body.data._id}/download`)
            .set("Authorization", `Bearer ${token}`);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error, "CASE_ACCESS_DENIED");
        assert.doesNotMatch(JSON.stringify(denied.body), /storedFilename|private-evidence|caseId|fileName/i);
        const deniedAudit = await waitForAudit({
            entityType: "Evidence",
            actor: officer.userId,
            action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
            "changes.after.downloadOutcome": "case_access_denied",
        });
        assert.ok(deniedAudit);
        assert.equal(deniedAudit.entityId, null);
    } finally {
        await Case.updateOne({ _id: caseRecord._id }, { $set: { assignedOfficerIds: originalAssignment } });
    }
});

test("evidence download handles invalid IDs and missing records", async () => {
    const invalid = await request(app).get("/api/evidence/not-an-id/download").set("Authorization", `Bearer ${token}`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "INVALID_EVIDENCE_ID");
    const invalidAudit = await waitForAudit({
        entityType: "Evidence",
        actor: officer.userId,
        action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
        "changes.after.downloadOutcome": "invalid_evidence_id",
    });
    assert.ok(invalidAudit);
    assert.equal(invalidAudit.entityId, null);

    const missing = await request(app).get("/api/evidence/507f1f77bcf86cd799439011/download").set("Authorization", `Bearer ${token}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "EVIDENCE_NOT_FOUND");
    const missingAudit = await waitForAudit({
        entityType: "Evidence",
        entityId: "507f1f77bcf86cd799439011",
        action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
        "changes.after.downloadOutcome": "evidence_not_found",
    });
    assert.ok(missingAudit);
});

test("evidence download returns a consistent not found response when storage is missing", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-MISSING-FILE");
    const record = await Evidence.findById(uploaded.body.data._id).select("+storedFilename");
    await evidenceFileService.deleteStoredFile(record.storedFilename);
    const response = await request(app)
        .get(`/api/evidence/${record._id}/download`)
        .set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "EVIDENCE_FILE_NOT_FOUND");
    assert.doesNotMatch(JSON.stringify(response.body), /storedFilename|private-evidence|[A-Z]:\\/i);
    const missingFileAudit = await waitForAudit({
        entityType: "Evidence",
        entityId: record._id,
        action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
        "changes.after.downloadOutcome": "file_missing",
    });
    assert.ok(missingFileAudit);
    assert.equal(missingFileAudit.changes.after.caseId, caseRecord._id.toString());
    assert.doesNotMatch(JSON.stringify(missingFileAudit), /storedFilename|private-evidence|[A-Z]:\\/i);
});

test("download remains successful if its post-transfer audit write fails and reports the audit failure", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-AUDIT-FAILURE");
    const record = await Evidence.findById(uploaded.body.data._id);
    const originalLog = auditService.log;
    const originalError = console.error;
    const reportedErrors = [];
    mock.method(auditService, "log", async () => { throw new Error("simulated audit write failure"); });
    mock.method(console, "error", (...args) => reportedErrors.push(args));

    try {
        const response = await request(app)
            .get(`/api/evidence/${record._id}/download`)
            .set("Authorization", `Bearer ${token}`)
            .buffer(true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, evidenceBytes);
        assert.ok(reportedErrors.some(([message]) => message === "Evidence download audit logging failed:"));
    } finally {
        auditService.log = originalLog;
        console.error = originalError;
    }
});

test("an interrupted download records exactly one stream_interrupted failure", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-INTERRUPTED");
    let pushed = false;
    const source = new Readable({
        read() {
            if (pushed) return;
            pushed = true;
            this.push(Buffer.alloc(32 * 1024, "a"));
            setTimeout(() => { if (!this.destroyed) this.push(Buffer.alloc(32 * 1024, "b")); }, 100);
        },
    });
    const originalRead = evidenceFileService.readStoredFile;
    mock.method(evidenceFileService, "readStoredFile", () => source);
    try {
        const response = await waitForDownloadResponse(uploaded.body.data._id, { abortOnData: true });
        assert.equal(response.status, 200);
        assert.equal(response.aborted, true);
        const audit = await waitForAudit({
            entityType: "Evidence",
            entityId: uploaded.body.data._id,
            action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
            "changes.after.downloadOutcome": "stream_interrupted",
        });
        assert.ok(audit);
        assert.equal(await countDownloadEvents(uploaded.body.data._id), 1);
    } finally {
        source.destroy();
        evidenceFileService.readStoredFile = originalRead;
    }
});

test("a stream error before headers returns the safe 500 response and records one failure", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-STREAM-ERROR-BEFORE-HEADERS");
    let failed = false;
    const source = new Readable({
        read() {
            if (failed) return;
            failed = true;
            process.nextTick(() => this.destroy(new Error("simulated stream read failure")));
        },
    });
    const originalRead = evidenceFileService.readStoredFile;
    mock.method(evidenceFileService, "readStoredFile", () => source);
    try {
        const response = await request(app)
            .get(`/api/evidence/${uploaded.body.data._id}/download`)
            .set("Authorization", `Bearer ${token}`);
        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { success: false, message: "Server error", error: "SERVER_ERROR" });
        const audit = await waitForAudit({
            entityType: "Evidence",
            entityId: uploaded.body.data._id,
            action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
            "changes.after.downloadOutcome": "stream_failed",
        });
        assert.ok(audit);
        assert.equal(await countDownloadEvents(uploaded.body.data._id), 1);
    } finally {
        source.destroy();
        evidenceFileService.readStoredFile = originalRead;
    }
});

test("a stream error after headers terminates the response and records one failure", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-STREAM-ERROR-AFTER-HEADERS");
    let pushed = false;
    const source = new Readable({
        read() {
            if (pushed) return;
            pushed = true;
            this.push(Buffer.from("partial evidence"));
            setTimeout(() => this.destroy(new Error("simulated stream failure after headers")), 25);
        },
    });
    const originalRead = evidenceFileService.readStoredFile;
    mock.method(evidenceFileService, "readStoredFile", () => source);
    try {
        const response = await waitForDownloadResponse(uploaded.body.data._id);
        assert.equal(response.status, 200);
        assert.equal(response.aborted, true);
        const audit = await waitForAudit({
            entityType: "Evidence",
            entityId: uploaded.body.data._id,
            action: "EVIDENCE_FILE_DOWNLOAD_FAILED",
            "changes.after.downloadOutcome": "stream_failed",
        });
        assert.ok(audit);
        assert.equal(await countDownloadEvents(uploaded.body.data._id), 1);
    } finally {
        source.destroy();
        evidenceFileService.readStoredFile = originalRead;
    }
});

test("audit rejection from a stream event handler is handled without an unhandled rejection", async () => {
    const uploaded = await upload("E-EVIDENCE-DOWNLOAD-STREAM-AUDIT-FAILURE");
    let pushed = false;
    const source = new Readable({
        read() {
            if (pushed) return;
            pushed = true;
            this.push(Buffer.from("partial evidence"));
            setTimeout(() => this.destroy(new Error("simulated stream failure")), 25);
        },
    });
    const originalRead = evidenceFileService.readStoredFile;
    const originalLog = auditService.log;
    const originalError = console.error;
    let unhandledRejection;
    const reportedErrors = [];
    const onUnhandledRejection = (error) => { unhandledRejection = error; };
    mock.method(evidenceFileService, "readStoredFile", () => source);
    mock.method(auditService, "log", async () => { throw new Error("simulated audit write failure"); });
    mock.method(console, "error", (...args) => reportedErrors.push(args));
    process.once("unhandledRejection", onUnhandledRejection);
    try {
        const response = await waitForDownloadResponse(uploaded.body.data._id);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(response.aborted, true);
        assert.equal(unhandledRejection, undefined);
        assert.ok(reportedErrors.some(([message]) => message === "Evidence download audit logging failed:"));
    } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection);
        source.destroy();
        evidenceFileService.readStoredFile = originalRead;
        auditService.log = originalLog;
        console.error = originalError;
    }
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
