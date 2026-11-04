const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "case-relationships-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Case = require("../models/Case");
const Criminal = require("../models/Criminal");
const Evidence = require("../models/Evidence");

let mongoServer;
let app;
const tokens = {};
const officers = {};
let sourceCase;
let visibleCriminalCase;
let visibleHashCase;
let inaccessibleCase;
let sourceWithoutValidHash;
let candidateWithoutHash;
let candidateWithMalformedHash;
const password = "Relationships@123";
const sharedHash = "a".repeat(64);

const auth = (key) => ({ Authorization: `Bearer ${tokens[key]}` });

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const makeCase = (caseNo, officerId, criminalIds = []) => Case.create({
    caseNo,
    firId: new mongoose.Types.ObjectId(),
    assignedOfficerIds: [officerId],
    criminalIds,
    title: `${caseNo} title`,
    description: `${caseNo} description`,
    startDate: "2026-10-01",
    status: "Open",
    priority: "Medium",
});

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-case-relationships"));
    app = createApp();
    const passwordHash = await bcrypt.hash(password, 4);

    for (const [key, rank] of [["si", "si"], ["other", "si"], ["inspector", "inspector"]]) {
        const user = await User.create({
            username: `relationship-${key}`,
            email: `relationship-${key}@crms.test`,
            passwordHash,
            role: "officer",
            status: "approved",
            isActive: true,
        });
        officers[key] = await Officer.create({
            userId: user._id,
            officerId: `REL-${key.toUpperCase()}`,
            badgeNumber: `REL${key === "si" ? "001" : key === "other" ? "002" : "003"}`,
            name: `Relationship ${key}`,
            rank,
            department: "Criminal Investigation",
            station: "Relationship Station",
            phoneNumber: "5550000000",
            address: "Relationship Street",
            joiningDate: "2020-01-01",
            status: "active",
        });
        tokens[key] = await login(user.username);
    }
    const admin = await User.create({
        username: "relationship-admin",
        email: "relationship-admin@crms.test",
        passwordHash,
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    tokens.admin = await login(admin.username);

    const criminal = await Criminal.create({
        criminalId: "REL-CRIM-001",
        fullName: "Relationship Criminal",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "Relationship Address",
        status: "active",
    });

    sourceCase = await makeCase("REL-CASE-001", officers.si._id, [criminal._id]);
    visibleCriminalCase = await makeCase("REL-CASE-002", officers.si._id, [criminal._id]);
    visibleHashCase = await makeCase("REL-CASE-003", officers.si._id, [criminal._id]);
    inaccessibleCase = await makeCase("REL-CASE-004", officers.inspector._id, [criminal._id]);
    sourceWithoutValidHash = await makeCase("REL-CASE-005", officers.si._id);
    candidateWithoutHash = await makeCase("REL-CASE-006", officers.si._id);
    candidateWithMalformedHash = await makeCase("REL-CASE-007", officers.si._id);

    await Evidence.create({
        evidenceId: "REL-EV-001",
        caseId: sourceCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Source evidence",
        collectedBy: officers.si._id,
        collectionDate: "2026-10-01",
        location: "Relationship locker",
        fileHash: sharedHash,
        status: "Collected",
    });
    await Evidence.create({
        evidenceId: "REL-EV-002",
        caseId: visibleHashCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Matching evidence",
        collectedBy: officers.si._id,
        collectionDate: "2026-10-01",
        location: "Relationship locker",
        fileHash: sharedHash.toUpperCase(),
        status: "Collected",
    });
    await Evidence.create({
        evidenceId: "REL-EV-003",
        caseId: visibleCriminalCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Different evidence",
        collectedBy: officers.si._id,
        collectionDate: "2026-10-01",
        location: "Relationship locker",
        fileHash: "b".repeat(64),
        status: "Collected",
    });
    await Evidence.collection.insertOne({
        evidenceId: "REL-EV-004",
        caseId: visibleCriminalCase._id,
        investigationRound: 1,
        type: "Document",
        description: "Malformed hash",
        collectedBy: officers.si._id,
        collectionDate: new Date("2026-10-01"),
        location: "Relationship locker",
        fileHash: "not-a-sha256-hash",
        status: "Collected",
    });
    await Evidence.collection.insertOne({
        evidenceId: "REL-EV-005",
        caseId: sourceWithoutValidHash._id,
        investigationRound: 1,
        type: "Document",
        description: "Missing source hash",
        collectedBy: officers.si._id,
        collectionDate: new Date("2026-10-01"),
        location: "Relationship locker",
        status: "Collected",
    });
    await Evidence.collection.insertOne({
        evidenceId: "REL-EV-006",
        caseId: candidateWithoutHash._id,
        investigationRound: 1,
        type: "Document",
        description: "Missing candidate hash",
        collectedBy: officers.si._id,
        collectionDate: new Date("2026-10-01"),
        location: "Relationship locker",
        status: "Collected",
    });
    await Evidence.collection.insertOne({
        evidenceId: "REL-EV-007",
        caseId: candidateWithMalformedHash._id,
        investigationRound: 1,
        type: "Document",
        description: "Malformed candidate hash",
        collectedBy: officers.si._id,
        collectionDate: new Date("2026-10-01"),
        location: "Relationship locker",
        fileHash: "malformed",
        status: "Collected",
    });
});

test.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("returns deterministic shared-criminal and evidence-hash reasons without sensitive fields", async () => {
    const response = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .set(auth("si"));
    assert.equal(response.status, 200);
    assert.equal(response.body.pagination.totalRecords, 2);
    const criminalRelationship = response.body.data.find((item) => String(item.caseId) === String(visibleCriminalCase._id));
    const hashRelationship = response.body.data.find((item) => String(item.caseId) === String(visibleHashCase._id));
    assert.deepEqual(criminalRelationship.reasons, ["Shared criminal record"]);
    assert.deepEqual(hashRelationship.reasons, ["Shared criminal record", "Identical evidence file hash"]);
    assert.equal(JSON.stringify(response.body).includes(sharedHash), false);
    assert.equal(JSON.stringify(response.body).includes("fileName"), false);
    assert.equal(JSON.stringify(response.body).includes("firId"), false);
});

test("combines rules and supports rule filtering, pagination, and no false matches", async () => {
    const combined = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .query({ rules: "criminal,evidence_hash", limit: 1 })
        .set(auth("si"));
    assert.equal(combined.status, 200);
    assert.equal(combined.body.pagination.totalRecords, 2);
    assert.equal(combined.body.pagination.totalPages, 2);

    const criminalOnly = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .query({ rules: "criminal" })
        .set(auth("si"));
    assert.equal(criminalOnly.status, 200);
    assert.deepEqual(criminalOnly.body.data.map((item) => item.caseNo), ["REL-CASE-002", "REL-CASE-003"]);
});

test("ignores missing and malformed hashes on source and candidate evidence", async () => {
    const sourceResponse = await request(app)
        .get(`/api/cases/${sourceWithoutValidHash._id}/relationships`)
        .query({ rules: "evidence_hash" })
        .set(auth("si"));
    assert.equal(sourceResponse.status, 200);
    assert.equal(sourceResponse.body.pagination.totalRecords, 0);

    const validSourceResponse = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .query({ rules: "evidence_hash" })
        .set(auth("si"));
    assert.equal(validSourceResponse.status, 200);
    assert.deepEqual(validSourceResponse.body.data.map((item) => item.caseNo), ["REL-CASE-003"]);
});

test("does not disclose inaccessible candidates or unauthorized source cases", async () => {
    const response = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .set(auth("other"));
    assert.equal(response.status, 403);

    const visible = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .query({ limit: 1 })
        .set(auth("si"));
    assert.equal(visible.body.data.some((item) => item.caseNo === "REL-CASE-004"), false);
    assert.equal(visible.body.pagination.totalRecords, 2);
    assert.equal(visible.body.pagination.totalPages, 2);

    const senior = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .set(auth("inspector"));
    assert.equal(senior.status, 200);
    assert.equal(senior.body.pagination.totalRecords, 3);
});

test("keeps repeated rules allowlisted and denies administrators through the officer-only route", async () => {
    const repeated = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .query({ rules: ["criminal", "criminal", "evidence_hash"] })
        .set(auth("si"));
    assert.equal(repeated.status, 200);
    const combined = repeated.body.data.find((item) => item.caseNo === "REL-CASE-003");
    assert.deepEqual(combined.reasons, ["Shared criminal record", "Identical evidence file hash"]);

    const adminResponse = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`)
        .set(auth("admin"));
    assert.equal(adminResponse.status, 403);
    assert.equal(adminResponse.body.error, "INSUFFICIENT_PERMISSIONS");
});

test("rejects invalid IDs, pagination, rules, and unauthenticated requests", async () => {
    for (const query of [
        { page: "2abc" },
        { page: "0" },
        { limit: "101" },
        { limit: "20xyz" },
        { rules: "phone" },
        { rules: ["criminal", "phone"] },
        { rules: "" },
    ]) {
        const response = await request(app)
            .get(`/api/cases/${sourceCase._id}/relationships`)
            .query(query)
            .set(auth("si"));
        assert.equal(response.status, 400);
    }

    const invalidId = await request(app)
        .get("/api/cases/not-an-id/relationships")
        .set(auth("si"));
    assert.equal(invalidId.status, 400);

    const unauthenticated = await request(app)
        .get(`/api/cases/${sourceCase._id}/relationships`);
    assert.equal(unauthenticated.status, 401);
});
