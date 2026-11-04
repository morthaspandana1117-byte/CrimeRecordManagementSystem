const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "case-timeline-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const CaseHistory = require("../models/CaseHistory");
const AuditLog = require("../models/AuditLog");
const Evidence = require("../models/Evidence");

let mongoServer;
let app;
const tokens = {};
let visibleCase;
let emptyCase;
let otherCase;
const password = "Timeline@123";

const auth = (key) => ({ Authorization: `Bearer ${tokens[key]}` });

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-case-timeline"));
    app = createApp();
    const passwordHash = await bcrypt.hash(password, 4);

    for (const [key, rank] of [["si", "si"], ["other", "si"]]) {
        const user = await User.create({
            username: `timeline-${key}`,
            email: `timeline-${key}@crms.test`,
            passwordHash,
            role: "officer",
            status: "approved",
            isActive: true,
        });
        const officer = await Officer.create({
            userId: user._id,
            officerId: `TIMELINE-${key.toUpperCase()}`,
            badgeNumber: key === "si" ? "TL0001" : "TL0002",
            name: `Timeline ${key}`,
            rank,
            department: "Criminal Investigation",
            station: "Timeline Station",
            phoneNumber: "5550000000",
            address: "Timeline Street",
            joiningDate: "2020-01-01",
            status: "active",
        });
        tokens[key] = await login(user.username);
        if (key === "si") tokens.siOfficerId = officer._id;
    }

    const fir = await FIR.create({
        firNo: "TIMELINE-FIR-001",
        date: "2026-10-01",
        policeStation: "Timeline Station",
        complaint: { complainantName: "Timeline Complainant", complaintText: "Timeline complaint" },
        description: "Timeline FIR",
        crimeType: "Theft",
        location: { address: "Timeline Road", city: "Timeline City", state: "Timeline State", pincode: "500001" },
        registeredBy: tokens.siOfficerId,
        criminalIds: [],
        status: "Open",
    });
    visibleCase = await Case.create({
        caseNo: "TIMELINE-CASE-001",
        firId: fir._id,
        assignedOfficerIds: [tokens.siOfficerId],
        criminalIds: [],
        title: "Timeline case",
        description: "Case timeline fixture",
        startDate: "2026-10-02",
        status: "Open",
        priority: "High",
    });
    emptyCase = await Case.create({
        caseNo: "TIMELINE-CASE-002",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [tokens.siOfficerId],
        criminalIds: [],
        title: "Empty timeline case",
        description: "No events",
        startDate: "2026-10-03",
        status: "Open",
        priority: "Low",
    });
    otherCase = await Case.create({
        caseNo: "TIMELINE-CASE-003",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [tokens.siOfficerId],
        criminalIds: [],
        title: "Other timeline case",
        description: "Other case events",
        startDate: "2026-10-04",
        status: "Open",
        priority: "Low",
    });

    const actor = await User.findOne({ username: "timeline-si" });
    const evidence = await Evidence.create({
        evidenceId: "TIMELINE-EV-001",
        caseId: visibleCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Timeline evidence",
        collectedBy: tokens.siOfficerId,
        currentCustodian: tokens.siOfficerId,
        collectionDate: "2026-10-02",
        location: "Timeline locker",
        status: "Collected",
    });
    const otherEvidence = await Evidence.create({
        evidenceId: "TIMELINE-EV-002",
        caseId: otherCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Other case evidence",
        collectedBy: tokens.siOfficerId,
        currentCustodian: tokens.siOfficerId,
        collectionDate: "2026-10-04",
        location: "Other locker",
        status: "Collected",
    });
    await CaseHistory.create({
        caseId: visibleCase._id,
        actionType: "case_created",
        description: "Case created for timeline",
        performedBy: actor._id,
        performedByOfficer: tokens.siOfficerId,
        timestamp: new Date("2026-10-01T10:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "CASE_CREATED",
        entityType: "Case",
        entityId: visibleCase._id,
        occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "EVIDENCE_FILE_UPLOADED",
        entityType: "Evidence",
        entityId: evidence._id,
        occurredAt: new Date("2026-10-02T10:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "CASE_STATUS_CHANGED",
        entityType: "Case",
        entityId: visibleCase._id,
        occurredAt: new Date("2026-10-03T10:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "FIR_STATUS_CHANGED",
        entityType: "FIR",
        entityId: fir._id,
        occurredAt: new Date("2026-10-03T11:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "EVIDENCE_FILE_UPLOADED",
        entityType: "Evidence",
        entityId: otherEvidence._id,
        occurredAt: new Date("2026-10-04T10:00:00.000Z"),
    });
    await AuditLog.create({
        actor: actor._id,
        action: "FIR_STATUS_CHANGED",
        entityType: "FIR",
        entityId: new mongoose.Types.ObjectId(),
        occurredAt: new Date("2026-10-05T10:00:00.000Z"),
    });
});

test.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("retrieves a newest-first timeline with safe actor and category fields", async () => {
    const response = await request(app)
        .get(`/api/cases/${visibleCase._id}/timeline`)
        .set(auth("si"));
    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.totalRecords, 4);
    assert.equal(response.body.data[0].action, "FIR_STATUS_CHANGED");
    assert.equal(response.body.data[0].actor, "timeline-si");
    assert.equal(response.body.data[0].category, "fir");
    assert.equal(response.body.data[0].changes, undefined);
    assert.deepEqual(response.body.data.map((event) => event.description), ["The related FIR status changed.", "The case status changed.", "An evidence file was uploaded.", "Case created for timeline"]);
    assert.equal(response.body.data.some((event) => event.action === "EVIDENCE_FILE_UPLOADED"), true);
    assert.equal(response.body.data.some((event) => event.action === "FIR_STATUS_CHANGED"), true);
    assert.equal(response.body.data.some((event) => event.entityId === otherCase._id.toString()), false);
    assert.equal(response.body.data.filter((event) => event.action === "FIR_STATUS_CHANGED").length, 1);
});

test("supports pagination and an empty timeline", async () => {
    const paged = await request(app)
        .get(`/api/cases/${visibleCase._id}/timeline`)
        .query({ page: 2, limit: 1 })
        .set(auth("si"));
    assert.equal(paged.status, 200);
    assert.equal(paged.body.data.length, 1);
    assert.equal(paged.body.pagination.totalPages, 4);

    const empty = await request(app)
        .get(`/api/cases/${emptyCase._id}/timeline`)
        .set(auth("si"));
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data, []);
    assert.equal(empty.body.pagination.totalRecords, 0);
});

test("rejects malformed pagination values and preserves distinct mapped events", async () => {
    for (const [query, error] of [
        [{ page: "2abc" }, "INVALID_PAGE"],
        [{ page: "0" }, "INVALID_PAGE"],
        [{ limit: "20xyz" }, "INVALID_LIMIT"],
        [{ limit: "101" }, "INVALID_LIMIT"],
    ]) {
        const response = await request(app)
            .get(`/api/cases/${visibleCase._id}/timeline`)
            .query(query)
            .set(auth("si"));
        assert.equal(response.status, 400);
        assert.equal(response.body.error, error);
    }

    await CaseHistory.create({
        caseId: visibleCase._id,
        actionType: "case_status_changed",
        description: "A distinct later status event",
        performedBy: (await User.findOne({ username: "timeline-si" }))._id,
        timestamp: new Date("2026-10-10T10:00:00.000Z"),
    });
    const response = await request(app)
        .get(`/api/cases/${visibleCase._id}/timeline`)
        .set(auth("si"));
    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.totalRecords, 5);
    assert.equal(response.body.data.some((event) => event.description === "A distinct later status event"), true);
});

test("rejects invalid, nonexistent, unauthenticated, and unauthorized timeline access", async () => {
    const invalid = await request(app).get("/api/cases/not-an-id/timeline").set(auth("si"));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "INVALID_CASE_ID");

    const nonexistent = await request(app).get(`/api/cases/${new mongoose.Types.ObjectId()}/timeline`).set(auth("si"));
    assert.equal(nonexistent.status, 404);

    const unauthenticated = await request(app).get(`/api/cases/${visibleCase._id}/timeline`);
    assert.equal(unauthenticated.status, 401);

    const unauthorized = await request(app)
        .get(`/api/cases/${visibleCase._id}/timeline`)
        .set(auth("other"));
    assert.equal(unauthorized.status, 403);
});
