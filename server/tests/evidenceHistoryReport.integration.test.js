const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "evidence-history-report-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const EvidenceCustodyHistory = require("../models/EvidenceCustodyHistory");
const AuditLog = require("../models/AuditLog");

let mongoServer;
let app;
let assignedToken;
let outsideToken;
let evidence;
let outsideEvidence;
let assignedOfficer;
let outsideOfficer;
const password = "EvidenceReport@123";

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createOfficer = async (username, rank) => {
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    return {
        user,
        officer: await Officer.create({
            userId: user._id,
            officerId: `RPT-${username}`,
            badgeNumber: `R${username.slice(-5)}`,
            name: username,
            rank,
            department: "Criminal Investigation",
            station: "Report Station",
            phoneNumber: "5550101000",
            address: "Report Avenue",
            joiningDate: "2020-01-01",
            status: "active",
        }),
    };
};

const pdfText = (response) => [...response.body.toString("latin1").matchAll(/<([0-9a-f]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, "hex").toString("latin1"))
    .join("");

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-evidence-history-report"));
    app = createApp();

    const assigned = await createOfficer("report-assigned", "investigating_officer");
    const outside = await createOfficer("report-outside", "investigating_officer");
    assignedOfficer = assigned.officer;
    outsideOfficer = outside.officer;
    assignedToken = await login("report-assigned");
    outsideToken = await login("report-outside");

    const assignedFir = await FIR.create({
        firNo: "RPT-FIR-1",
        date: "2026-10-01",
        policeStation: "Report Station",
        complaint: { complainantName: "Reporter", complaintText: "Report fixture" },
        description: "Report fixture",
        crimeType: "Theft",
        location: { address: "Report Avenue", city: "Test", state: "Test", pincode: "123456" },
        registeredBy: assignedOfficer._id,
        criminalIds: [],
        status: "Open",
    });
    const outsideFir = await FIR.create({
        ...assignedFir.toObject(),
        _id: undefined,
        firNo: "RPT-FIR-2",
    });
    const assignedCase = await Case.create({
        caseNo: "RPT-CASE-1",
        firId: assignedFir._id,
        assignedOfficerIds: [assignedOfficer._id],
        criminalIds: [],
        title: "Report case",
        description: "Report fixture",
        startDate: "2026-10-01",
        status: "Open",
        priority: "High",
    });
    const outsideCase = await Case.create({
        caseNo: "RPT-CASE-2",
        firId: outsideFir._id,
        assignedOfficerIds: [outsideOfficer._id],
        criminalIds: [],
        title: "Outside case",
        description: "Report fixture",
        startDate: "2026-10-01",
        status: "Open",
        priority: "High",
    });

    evidence = await Evidence.create({
        evidenceId: "RPT-EVIDENCE-1",
        caseId: assignedCase._id,
        investigationRound: 1,
        type: "Digital",
        description: "Report evidence description",
        collectedBy: assignedOfficer._id,
        currentCustodian: assignedOfficer._id,
        collectionDate: "2026-10-02",
        location: "Evidence room",
        status: "Stored",
        verificationStatus: "verified",
        verifiedAt: "2026-10-03",
        fileName: "private-original.pdf",
        storedFilename: "private-storage-name",
    });
    outsideEvidence = await Evidence.create({
        evidenceId: "RPT-EVIDENCE-2",
        caseId: outsideCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Outside evidence",
        collectedBy: outsideOfficer._id,
        collectionDate: "2026-10-02",
        location: "Evidence room",
        status: "Collected",
    });

    await AuditLog.create({
        actor: assigned.user._id,
        action: "EVIDENCE_INTEGRITY_CHECKED",
        entityType: "Evidence",
        entityId: evidence._id,
        occurredAt: new Date("2026-10-04T10:00:00Z"),
        changes: { after: { evidenceId: evidence.evidenceId, integrityResult: "intact" } },
    });
    await AuditLog.create({
        actor: assigned.user._id,
        action: "EVIDENCE_VERIFIED",
        entityType: "Evidence",
        entityId: evidence._id,
        occurredAt: new Date("2026-10-04T11:00:00Z"),
    });
    await EvidenceCustodyHistory.create({
        evidenceId: evidence._id,
        caseId: assignedCase._id,
        action: "TRANSFER_INITIATED",
        fromCustodian: assignedOfficer._id,
        toCustodian: outsideOfficer._id,
        performedByOfficer: assignedOfficer._id,
        timestamp: new Date("2026-10-04T12:00:00Z"),
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("evidence report requires authentication, validates IDs, and enforces case access", async () => {
    assert.equal((await request(app).get(`/api/evidence/${evidence._id}/report`)).status, 401);
    assert.equal((await request(app).get("/api/evidence/not-an-id/report").set("Authorization", `Bearer ${assignedToken}`)).status, 400);
    assert.equal((await request(app).get(`/api/evidence/${new mongoose.Types.ObjectId()}/report`).set("Authorization", `Bearer ${assignedToken}`)).status, 404);
    assert.equal((await request(app).get(`/api/evidence/${outsideEvidence._id}/report`).set("Authorization", `Bearer ${assignedToken}`)).status, 403);
});

test("authorized evidence report contains safe metadata, integrity, custody, and audit history", async () => {
    const response = await request(app)
        .get(`/api/evidence/${evidence._id}/report`)
        .set("Authorization", `Bearer ${assignedToken}`);
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /application\/pdf/);
    assert.match(response.headers["content-disposition"], /attachment; filename="evidence-history-RPT-EVIDENCE-1\.pdf"/);
    assert.ok(response.body.toString("latin1").startsWith("%PDF-"));
    const content = pdfText(response);
    assert.match(content, /RPT-EVIDENCE-1/);
    assert.match(content, /Report evidence description/);
    assert.match(content, /intact/);
    assert.match(content, /TRANSFER_INITIATED/);
    assert.match(content, /Pending/);
    assert.match(content, /EVIDENCE_VERIFIED/);
    assert.match(content, /Generated:/);
    assert.doesNotMatch(content, /private-storage-name|private-original\.pdf|password|token/i);
});

test("evidence report clearly describes empty history sections", async () => {
    const response = await request(app)
        .get(`/api/evidence/${outsideEvidence._id}/report`)
        .set("Authorization", `Bearer ${outsideToken}`);
    assert.equal(response.status, 200);
    const content = pdfText(response);
    assert.match(content, /No integrity check has been recorded/);
    assert.match(content, /No custody history is available/);
    assert.match(content, /No relevant audit history is available/);
});
