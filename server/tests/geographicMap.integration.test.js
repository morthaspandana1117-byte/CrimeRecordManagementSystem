const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "geographic-map-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const FIR = require("../models/FIR");
const Case = require("../models/Case");

let mongoServer;
let app;
let officers;
let tokens;
let criminal;
const password = "GeoMap@123";
const auth = (officer) => ({ Authorization: `Bearer ${tokens[officer]}` });

const createOfficer = async (username, rank, badgeNumber) => {
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const officer = await Officer.create({
        userId: user._id,
        officerId: `GEO-${username}`,
        badgeNumber,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "Geo Test Station",
        phoneNumber: "5550101000",
        address: "Synthetic test address",
        joiningDate: "2020-01-01",
        status: "active",
    });
    const login = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(login.status, 200);
    return { officer, token: login.body.token };
};

const firPayload = (firNo, overrides = {}) => ({
    firNo,
    date: "2026-10-12",
    policeStation: "Geo Test Station",
    complaint: { complainantName: "Synthetic complainant", complaintText: "Synthetic map test record" },
    description: "Synthetic geographic map test",
    crimeType: "Theft",
    location: { address: "Synthetic address", city: "Test City", state: "Test State", pincode: "000000" },
    criminalIds: [String(criminal._id)],
    status: "Open",
    ...overrides,
});

const createCase = (fir, caseNo, status, officerId) => Case.create({
    caseNo,
    firId: fir._id,
    assignedOfficerIds: [officerId],
    criminalIds: [criminal._id],
    title: "Synthetic map case",
    description: "Synthetic map case description",
    startDate: "2026-10-12",
    status,
    priority: "Medium",
});

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-geographic-map"));
    app = createApp();
    officers = {};
    tokens = {};

    const first = await createOfficer("geo-officer-a", "investigating_officer", "GEO001");
    const second = await createOfficer("geo-officer-b", "investigating_officer", "GEO002");
    const senior = await createOfficer("geo-inspector", "inspector", "GEO003");
    officers.a = first.officer;
    officers.b = second.officer;
    officers.inspector = senior.officer;
    tokens.a = first.token;
    tokens.b = second.token;
    tokens.inspector = senior.token;
    const adminUser = await User.create({
        username: "geo-system-admin",
        email: "geo-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    const adminLogin = await request(app).post("/api/auth/login").send({ username: adminUser.username, password });
    assert.equal(adminLogin.status, 200);
    tokens.admin = adminLogin.body.token;

    criminal = await Criminal.create({
        criminalId: "GEO-CRIMINAL-001",
        fullName: "Synthetic individual",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "Synthetic address",
        status: "active",
    });

    const mapped = await request(app)
        .post("/api/firs")
        .set(auth("a"))
        .send(firPayload("GEO-FIR-MAPPED", { latitude: 0, longitude: 0 }));
    assert.equal(mapped.status, 201);
    await createCase(mapped.body.data, "GEO-CASE-CLOSED", "Closed", officers.a._id);

    const missing = await request(app)
        .post("/api/firs")
        .set(auth("a"))
        .send(firPayload("GEO-FIR-MISSING"));
    assert.equal(missing.status, 201);

    await FIR.collection.insertOne({
        ...firPayload("GEO-FIR-INVALID"),
        registeredBy: officers.a._id,
        latitude: 91,
        longitude: 181,
        date: new Date("2026-10-12T00:00:00.000Z"),
        criminalIds: [criminal._id],
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    const foreign = await request(app)
        .post("/api/firs")
        .set(auth("b"))
        .send(firPayload("GEO-FIR-FOREIGN", { latitude: 40.7, longitude: -74.0 }));
    assert.equal(foreign.status, 201);
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("FIR coordinates are optional, paired, and validated on create and update", async () => {
    const edgeCoordinates = await request(app)
        .post("/api/firs")
        .set(auth("a"))
        .send(firPayload("GEO-FIR-EDGE", { latitude: -90, longitude: 180 }));
    assert.equal(edgeCoordinates.status, 201);
    assert.equal(edgeCoordinates.body.data.latitude, -90);
    assert.equal(edgeCoordinates.body.data.longitude, 180);

    const invalidCoordinates = [
        { latitude: 90.01, longitude: 0 },
        { latitude: 0, longitude: -180.01 },
        { latitude: "not-a-number", longitude: 0 },
        { latitude: 0 },
        { latitude: null, longitude: 3 },
    ];
    for (const [index, coordinates] of invalidCoordinates.entries()) {
        const response = await request(app)
            .post("/api/firs")
            .set(auth("a"))
            .send(firPayload(`GEO-FIR-BAD-${index}`, coordinates));
        assert.equal(response.status, 400);
    }

    const updateInvalid = await request(app)
        .put(`/api/firs/${edgeCoordinates.body.data._id}`)
        .set(auth("a"))
        .send({ latitude: 91, longitude: 181 });
    assert.equal(updateInvalid.status, 400);

    const clearCoordinates = await request(app)
        .put(`/api/firs/${edgeCoordinates.body.data._id}`)
        .set(auth("a"))
        .send({ latitude: null, longitude: null });
    assert.equal(clearCoordinates.status, 200);
    assert.equal(clearCoordinates.body.data.latitude, null);
    assert.equal(clearCoordinates.body.data.longitude, null);
});

test("map API returns only valid coordinates, safe marker details, and authorized records", async () => {
    const unauthenticated = await request(app).get("/api/firs/map");
    assert.equal(unauthenticated.status, 401);
    const systemAdmin = await request(app).get("/api/firs/map").set(auth("admin"));
    assert.equal(systemAdmin.status, 403);

    const ownRecords = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(ownRecords.status, 200);
    assert.equal(ownRecords.body.data.totalRecords, 4);
    assert.equal(ownRecords.body.data.mappedRecords, 1);
    assert.equal(ownRecords.body.data.unmappedRecords, 3);
    assert.deepEqual(ownRecords.body.data.records.map((record) => record.firNo), ["GEO-FIR-MAPPED"]);
    assert.deepEqual(Object.keys(ownRecords.body.data.records[0]).sort(), [
        "_id", "caseNo", "caseStatus", "crimeType", "date", "firNo", "latitude",
        "location", "longitude", "policeStation", "status",
    ].sort());
    assert.equal(ownRecords.body.data.records[0].complaint, undefined);
    assert.equal(ownRecords.body.data.records[0].location.address, undefined);
    assert.equal(ownRecords.body.data.records[0].caseNo, "GEO-CASE-CLOSED");

    const caseFilter = await request(app)
        .get("/api/firs/map?caseStatus=Closed&crimeType=Theft&fromDate=2026-10-12&toDate=2026-10-12")
        .set(auth("a"));
    assert.equal(caseFilter.status, 200);
    assert.equal(caseFilter.body.data.totalRecords, 1);
    assert.equal(caseFilter.body.data.mappedRecords, 1);
    assert.equal(caseFilter.body.data.records[0].firNo, "GEO-FIR-MAPPED");

    const otherOfficer = await request(app).get("/api/firs/map").set(auth("b"));
    assert.equal(otherOfficer.status, 200);
    assert.deepEqual(otherOfficer.body.data.records.map((record) => record.firNo), ["GEO-FIR-FOREIGN"]);
    assert.equal(otherOfficer.body.data.unmappedRecords, 0);

    const seniorOfficer = await request(app).get("/api/firs/map").set(auth("inspector"));
    assert.equal(seniorOfficer.status, 200);
    assert.equal(seniorOfficer.body.data.totalRecords, 5);
    assert.equal(seniorOfficer.body.data.mappedRecords, 2);
});

test("map endpoint rejects unsupported filters and invalid dates", async () => {
    for (const query of [
        "caseStatus=Unknown",
        "crimeType=Unknown",
        "fromDate=2026-02-30",
        "fromDate=2026-10-13&toDate=2026-10-12",
        "latitude[$gt]=0",
    ]) {
        const response = await request(app).get(`/api/firs/map?${query}`).set(auth("a"));
        assert.equal(response.status, 400, query);
    }

    const empty = await request(app).get("/api/firs/map?crimeType=Other").set(auth("a"));
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data.totalRecords, 0);
    assert.equal(empty.body.data.mappedRecords, 0);
    assert.equal(empty.body.data.unmappedRecords, 0);
    assert.deepEqual(empty.body.data.records, []);
});
