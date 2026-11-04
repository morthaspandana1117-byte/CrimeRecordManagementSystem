const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "advanced-search-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Case = require("../models/Case");
const FIR = require("../models/FIR");
const Criminal = require("../models/Criminal");
const Evidence = require("../models/Evidence");

let mongoServer;
let app;
const tokens = {};
const officers = {};
let restrictedCase;
const password = "Search@123";

const auth = (key) => ({ Authorization: `Bearer ${tokens[key]}` });

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-search"));
    app = createApp();
    const passwordHash = await bcrypt.hash(password, 4);

    for (const [key, rank] of [["si", "si"], ["inspector", "inspector"], ["constable", "constable"]]) {
        const user = await User.create({
            username: `search-${key}`,
            email: `search-${key}@crms.test`,
            passwordHash,
            role: "officer",
            status: "approved",
            isActive: true,
        });
        officers[key] = await Officer.create({
            userId: user._id,
            officerId: `SEARCH-${key.toUpperCase()}`,
            badgeNumber: `${key === "si" ? "S" : key === "inspector" ? "I" : "C"}EARCH`,
            name: `Search ${key}`,
            rank,
            department: "Criminal Investigation",
            station: "Search Station",
            phoneNumber: "5550000000",
            address: "Search Street",
            joiningDate: "2020-01-01",
            status: "active",
        });
        tokens[key] = await login(user.username);
    }
    const inactiveUser = await User.create({
        username: "search-inactive",
        email: "search-inactive@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: false,
    });
    await Officer.create({
        userId: inactiveUser._id,
        officerId: "SEARCH-INACTIVE",
        badgeNumber: "INACT1",
        name: "Search Inactive",
        rank: "si",
        department: "Criminal Investigation",
        station: "Search Station",
        phoneNumber: "5550000000",
        address: "Search Street",
        joiningDate: "2020-01-01",
        status: "active",
    });

    const fir = await FIR.create({
        firNo: "SEARCH-FIR-001",
        date: "2026-10-01",
        policeStation: "Search Station",
        complaint: { complainantName: "Search Complainant", complaintText: "Search complaint" },
        description: "Search FIR description",
        crimeType: "Theft",
        location: { address: "Search Road", city: "Search City", state: "Search State", pincode: "500001" },
        registeredBy: officers.inspector._id,
        criminalIds: [],
        status: "Open",
    });
    const assigned = await Case.create({
        caseNo: "SEARCH-CASE-001",
        firId: fir._id,
        assignedOfficerIds: [officers.si._id],
        criminalIds: [],
        title: "Searchable bicycle case",
        description: "Case visible to assigned officer",
        startDate: "2026-10-02",
        status: "Open",
        priority: "High",
    });
    restrictedCase = await Case.create({
        caseNo: "SEARCH-CASE-002",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [officers.inspector._id],
        criminalIds: [],
        title: "Restricted case",
        description: "Case hidden from SI",
        startDate: "2026-10-03",
        status: "Closed",
        priority: "Low",
    });
    const criminal = await Criminal.create({
        criminalId: "SEARCH-CRIM-001",
        fullName: "Search Criminal",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "Search Address",
        status: "active",
    });
    await Evidence.create({
        evidenceId: "SEARCH-EV-001",
        caseId: assigned._id,
        investigationRound: 1,
        type: "Document",
        description: "Search evidence",
        collectedBy: officers.si._id,
        currentCustodian: officers.si._id,
        collectionDate: "2026-10-04",
        uploadedAt: "2026-10-04",
        location: "Search Locker",
        status: "Collected",
        verificationStatus: "unverified",
    });
    tokens.criminal = criminal._id.toString();
});

test.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("searches authorized records with case-insensitive partial matching and pagination", async () => {
    const response = await request(app)
        .get("/api/search")
        .query({ category: "cases", keyword: "BICYCLE", priority: "High", page: 1, limit: 1 })
        .set(auth("si"));
    assert.equal(response.status, 200);
    assert.equal(response.body.totalRecords, 1);
    assert.equal(response.body.data[0].caseNo, "SEARCH-CASE-001");
});

test("applies category filters and does not expose unassigned cases", async () => {
    const siCases = await request(app).get("/api/search").query({ category: "cases" }).set(auth("si"));
    assert.equal(siCases.status, 200);
    assert.deepEqual(siCases.body.data.map((record) => record.caseNo), ["SEARCH-CASE-001"]);

    const evidence = await request(app)
        .get("/api/search")
        .query({ category: "evidence", type: "Document", uploadedFrom: "2026-10-01", uploadedTo: "2026-10-31" })
        .set(auth("si"));
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.data[0].evidenceId, "SEARCH-EV-001");
    assert.equal(evidence.body.data[0].storedFilename, undefined);
});

test("enforces case and evidence intersections against manipulated scope filters", async () => {
    const hiddenCase = await request(app)
        .get("/api/search")
        .query({ category: "cases", keyword: "SEARCH-CASE-002" })
        .set(auth("constable"));
    assert.equal(hiddenCase.status, 200);
    assert.equal(hiddenCase.body.totalRecords, 0);

    const assignedOfficerBypass = await request(app)
        .get("/api/search")
        .query({ category: "cases", assignedOfficerId: officers.inspector._id.toString() })
        .set(auth("si"));
    assert.equal(assignedOfficerBypass.status, 200);
    assert.equal(assignedOfficerBypass.body.totalRecords, 0);

    const unauthorizedEvidence = await request(app)
        .get("/api/search")
        .query({ category: "evidence", caseId: restrictedCase._id.toString() })
        .set(auth("si"));
    assert.equal(unauthorizedEvidence.status, 200);
    assert.equal(unauthorizedEvidence.body.totalRecords, 0);
});

test("FIR visibility follows the existing registered-by policy", async () => {
    const unauthorized = await request(app)
        .get("/api/search")
        .query({ category: "firs", keyword: "SEARCH-FIR-001" })
        .set(auth("si"));
    assert.equal(unauthorized.status, 200);
    assert.equal(unauthorized.body.totalRecords, 0);

    const authorized = await request(app)
        .get("/api/search")
        .query({ category: "firs", keyword: "SEARCH-FIR-001" })
        .set(auth("inspector"));
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.totalRecords, 1);
});

test("officer search follows rank management restrictions and account status semantics", async () => {
    const forbidden = await request(app).get("/api/search").query({ category: "officers" }).set(auth("constable"));
    assert.equal(forbidden.status, 403);

    const subordinate = await request(app)
        .get("/api/search")
        .query({ category: "officers", keyword: "SEARCH-SI", accountStatus: "active" })
        .set(auth("inspector"));
    assert.equal(subordinate.status, 200);
    assert.equal(subordinate.body.totalRecords, 1);
    assert.equal(subordinate.body.data[0].officerId, "SEARCH-SI");

    const inactive = await request(app)
        .get("/api/search")
        .query({ category: "officers", keyword: "SEARCH-INACTIVE", accountStatus: "inactive" })
        .set(auth("inspector"));
    assert.equal(inactive.status, 200);
    assert.equal(inactive.body.totalRecords, 1);
    assert.equal(inactive.body.data[0].officerId, "SEARCH-INACTIVE");
    assert.equal(inactive.body.data[0].userId, undefined);

    const invalid = await request(app)
        .get("/api/search")
        .query({ category: "cases", assignedOfficerId: "not-an-object-id" })
        .set(auth("inspector"));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "INVALID_ASSIGNEDOFFICERID");

    const noToken = await request(app).get("/api/search").query({ category: "cases" });
    assert.equal(noToken.status, 401);
});

test("rejects impossible calendar dates in category filters", async () => {
    const impossibleDay = await request(app)
        .get("/api/search")
        .query({ category: "cases", createdFrom: "2026-02-31" })
        .set(auth("inspector"));
    assert.equal(impossibleDay.status, 400);
    assert.equal(impossibleDay.body.error, "INVALID_CREATEDFROM");

    const impossibleMonth = await request(app)
        .get("/api/search")
        .query({ category: "firs", dateFrom: "2026-13-01" })
        .set(auth("inspector"));
    assert.equal(impossibleMonth.status, 400);
    assert.equal(impossibleMonth.body.error, "INVALID_DATEFROM");
});

test("all-category results retain separate authorized pagination metadata", async () => {
    const response = await request(app)
        .get("/api/search")
        .query({ category: "all", page: 1, limit: 1 })
        .set(auth("inspector"));
    assert.equal(response.status, 200);
    assert.equal(response.body.totalRecords, undefined);
    assert.equal(Array.isArray(response.body.pagination), true);
    const pagination = Object.fromEntries(response.body.pagination.map((metadata) => [metadata.category, metadata]));
    assert.equal(pagination.cases.page, 1);
    assert.equal(pagination.cases.limit, 1);
    assert.equal(pagination.cases.totalPages, 2);
    assert.equal(pagination.firs.totalPages, 1);
    assert.equal(pagination.criminals.totalPages, 1);
});
