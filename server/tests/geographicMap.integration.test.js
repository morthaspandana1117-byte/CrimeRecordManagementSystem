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
const Evidence = require("../models/Evidence");
const PoliceStation = require("../models/PoliceStation");

let mongoServer;
let app;
let officers;
let tokens;
let criminal;
let station;
let westStation;
const password = "GeoMap@123";
const auth = (officer) => ({ Authorization: `Bearer ${tokens[officer]}` });

const createOfficer = async (username, rank, badgeNumber, stationRecord = station) => {
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
        station: stationRecord.name,
        stationId: stationRecord._id,
        phoneNumber: "5550101000",
        address: "Synthetic test address",
        joiningDate: "2020-01-01",
        status: "active",
    });
    const login = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(login.status, 200);
    return { officer, token: login.body.token };
};

const firPayload = (firNo, overrides = {}, stationRecord = station) => ({
    firNo,
    date: "2026-10-12",
    policeStation: stationRecord.name,
    policeStationId: String(stationRecord._id),
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
    station = await PoliceStation.create({ name: "Geo Test Station", code: "GEO-01" });
    westStation = await PoliceStation.create({ name: "West Geo Station", code: "GEO-02" });
    const centralConstable = await createOfficer("geo-central-constable", "constable", "GEO001");
    const centralHeadConstable = await createOfficer("geo-central-head", "head_constable", "GEO002");
    const centralSI = await createOfficer("geo-central-si", "si", "GEO003");
    const centralInspector = await createOfficer("geo-central-inspector", "inspector", "GEO004");
    const westSI = await createOfficer("geo-west-si", "si", "GEO005", westStation);
    const westInspector = await createOfficer("geo-west-inspector", "inspector", "GEO006", westStation);
    officers = {
        a: centralConstable.officer,
        b: centralHeadConstable.officer,
        si: centralSI.officer,
        inspector: centralInspector.officer,
        westSI: westSI.officer,
        westInspector: westInspector.officer,
    };
    tokens = {
        a: centralConstable.token,
        b: centralHeadConstable.token,
        si: centralSI.token,
        inspector: centralInspector.token,
        westSI: westSI.token,
        westInspector: westInspector.token,
    };
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

    const westFIR = await request(app)
        .post("/api/firs")
        .set(auth("westSI"))
        .send(firPayload("GEO-FIR-WEST", { latitude: 34.05, longitude: -118.25 }, westStation));
    assert.equal(westFIR.status, 201);

    const mappedCase = await Case.findOne({ firId: mapped.body.data._id });
    await Evidence.create({
        evidenceId: "GEO-EVIDENCE-001",
        caseId: mappedCase._id,
        investigationRound: 1,
        type: "Physical",
        description: "Synthetic evidence for marker privacy test",
        collectedBy: officers.a._id,
        collectionDate: "2026-10-12",
        location: "Synthetic evidence location",
        status: "Collected",
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("FIR coordinates are optional, paired, and validated on create; registered coordinates are immutable", async () => {
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
    assert.equal(updateInvalid.status, 405);
    assert.equal(updateInvalid.body.error, "FIR_IMMUTABLE");

    const clearCoordinates = await request(app)
        .put(`/api/firs/${edgeCoordinates.body.data._id}`)
        .set(auth("a"))
        .send({ latitude: null, longitude: null });
    assert.equal(clearCoordinates.status, 405);
    assert.equal(clearCoordinates.body.error, "FIR_IMMUTABLE");
    const unchanged = await FIR.findById(edgeCoordinates.body.data._id);
    assert.equal(unchanged.latitude, -90);
    assert.equal(unchanged.longitude, 180);
    await FIR.deleteOne({ _id: edgeCoordinates.body.data._id });
});

test("map API shares station markers across ranks without granting FIR, case, or evidence access", async () => {
    const unauthenticated = await request(app).get("/api/firs/map");
    assert.equal(unauthenticated.status, 401);
    const systemAdmin = await request(app).get("/api/firs/map").set(auth("admin"));
    assert.equal(systemAdmin.status, 403);

    const ownRecords = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(ownRecords.status, 200);
    assert.equal(ownRecords.body.data.totalRecords, 3);
    assert.equal(ownRecords.body.data.mappedRecords, 2);
    assert.equal(ownRecords.body.data.unmappedRecords, 1);
    assert.equal(
        ownRecords.body.data.mappedRecords + ownRecords.body.data.unmappedRecords,
        ownRecords.body.data.totalRecords,
    );
    assert.deepEqual(
        ownRecords.body.data.records.map((record) => record.firNo).sort(),
        ["GEO-FIR-FOREIGN", "GEO-FIR-MAPPED"],
    );
    assert.deepEqual(Object.keys(ownRecords.body.data.records[0]).sort(), [
        "_id", "caseNo", "caseStatus", "crimeType", "date", "firNo", "latitude",
        "location", "longitude", "policeStation", "status",
    ].sort());
    assert.equal(ownRecords.body.data.records[0].complaint, undefined);
    assert.equal(ownRecords.body.data.records.every((record) => record.location.address === undefined), true);
    const mappedMarker = ownRecords.body.data.records.find((record) => record.firNo === "GEO-FIR-MAPPED");
    assert.equal(mappedMarker.caseNo, "GEO-CASE-CLOSED");

    for (const query of [
        "crimeType=Theft",
        "fromDate=2026-10-12",
        "toDate=2026-10-12",
        "fromDate=2026-10-12&toDate=2026-10-12&crimeType=Theft",
    ]) {
        const filtered = await request(app).get(`/api/firs/map?${query}`).set(auth("a"));
        assert.equal(filtered.status, 200, query);
        assert.equal(filtered.body.data.totalRecords, 3, query);
        assert.equal(filtered.body.data.mappedRecords, 2, query);
    }

    const caseFilter = await request(app)
        .get("/api/firs/map?caseStatus=Closed&crimeType=Theft&fromDate=2026-10-12&toDate=2026-10-12")
        .set(auth("a"));
    assert.equal(caseFilter.status, 200);
    assert.equal(caseFilter.body.data.totalRecords, 1);
    assert.equal(caseFilter.body.data.mappedRecords, 1);
    assert.equal(caseFilter.body.data.records[0].firNo, "GEO-FIR-MAPPED");

    const centralMarkers = ownRecords.body.data.records.map((record) => record.firNo).sort();
    for (const rank of ["b", "si", "inspector"]) {
        const sameStation = await request(app).get("/api/firs/map").set(auth(rank));
        assert.equal(sameStation.status, 200, rank);
        assert.deepEqual(sameStation.body.data.records.map((record) => record.firNo).sort(), centralMarkers, rank);
    }

    for (const rank of ["westSI", "westInspector"]) {
        const westMap = await request(app).get("/api/firs/map").set(auth(rank));
        assert.equal(westMap.status, 200, rank);
        assert.deepEqual(westMap.body.data.records.map((record) => record.firNo), ["GEO-FIR-WEST"], rank);
    }

    const forgedStationFilter = await request(app)
        .get(`/api/firs/map?stationId=${westStation._id}`)
        .set(auth("a"));
    assert.equal(forgedStationFilter.status, 400);
    assert.equal(forgedStationFilter.body.error, "INVALID_MAP_FILTER");

    const markerDoesNotGrantFIRAccess = await request(app)
        .get(`/api/firs/${mappedMarker._id}`)
        .set(auth("b"));
    assert.equal(markerDoesNotGrantFIRAccess.status, 403);
    const mappedCase = await Case.findOne({ firId: mappedMarker._id });
    const markerDoesNotGrantCaseAccess = await request(app)
        .get(`/api/cases/${mappedCase._id}`)
        .set(auth("b"));
    assert.equal(markerDoesNotGrantCaseAccess.status, 403);
    const mappedEvidence = await Evidence.findOne({ caseId: mappedCase._id });
    const markerDoesNotGrantEvidenceAccess = await request(app)
        .get(`/api/evidence/${mappedEvidence._id}`)
        .set(auth("b"));
    assert.equal(markerDoesNotGrantEvidenceAccess.status, 403);

    await User.updateOne({ _id: officers.a.userId }, { $set: { status: "pending" } });
    const unapprovedOfficer = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(unapprovedOfficer.status, 403);
    await User.updateOne({ _id: officers.a.userId }, { $set: { status: "approved" } });
    await User.updateOne({ _id: officers.a.userId }, { $set: { status: "rejected", isActive: false } });
    const rejectedOfficer = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(rejectedOfficer.status, 403);
    await User.updateOne({ _id: officers.a.userId }, { $set: { status: "approved", isActive: true } });

    await Officer.updateOne({ _id: officers.a._id }, { $set: { status: "inactive" } });
    const inactiveOfficer = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(inactiveOfficer.status, 403);
    await Officer.updateOne({ _id: officers.a._id }, { $set: { status: "active" } });

    await PoliceStation.updateOne({ _id: station._id }, { $set: { isActive: false } });
    const inactiveStationMap = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(inactiveStationMap.status, 403);
    assert.equal(inactiveStationMap.body.error, "STATION_ASSIGNMENT_INVALID");
    await PoliceStation.updateOne({ _id: station._id }, { $set: { isActive: true } });
});

test("legacy station correction restores same-station markers without granting FIR detail access", async () => {
    const legacy = await createOfficer("geo-legacy-asi", "asi", "GEO007");
    await Officer.collection.updateOne(
        { _id: legacy.officer._id },
        { $set: { rank: "ASI" }, $unset: { stationId: "" } },
    );

    const unassignedMap = await request(app)
        .get("/api/firs/map")
        .set("Authorization", `Bearer ${legacy.token}`);
    assert.equal(unassignedMap.status, 403);
    assert.equal(unassignedMap.body.error, "STATION_ASSIGNMENT_REQUIRED");

    const correction = await request(app)
        .patch(`/api/officers/${legacy.officer._id}/station`)
        .set(auth("admin"))
        .send({ stationId: String(station._id) });
    assert.equal(correction.status, 200);
    const corrected = await Officer.findById(legacy.officer._id).lean();
    assert.equal(String(corrected.stationId), String(station._id));
    assert.equal(corrected.station, station.name);
    assert.equal(corrected.rank, "ASI");

    const legacyMap = await request(app)
        .get("/api/firs/map")
        .set("Authorization", `Bearer ${legacy.token}`);
    const centralMap = await request(app).get("/api/firs/map").set(auth("a"));
    assert.equal(legacyMap.status, 200);
    assert.deepEqual(
        legacyMap.body.data.records.map((record) => record.firNo).sort(),
        centralMap.body.data.records.map((record) => record.firNo).sort(),
    );
    assert.ok(legacyMap.body.data.records.some((record) => record.firNo === "GEO-FIR-MAPPED"));

    const marker = legacyMap.body.data.records.find((record) => record.firNo === "GEO-FIR-MAPPED");
    const protectedDetails = await request(app)
        .get(`/api/firs/${marker._id}`)
        .set("Authorization", `Bearer ${legacy.token}`);
    assert.equal(protectedDetails.status, 403);
    assert.equal(protectedDetails.body.error, "FIR_ACCESS_DENIED");
});

test("map endpoint rejects unsupported filters and invalid dates", async () => {
    for (const query of [
        "caseStatus=Unknown",
        "crimeType=Unknown",
        `stationId=${westStation._id}`,
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

test("map counts reconcile while excluding legacy FIRs without a canonical station reference", async () => {
    const makeLegacyFIR = (firNo, coordinates = {}) => ({
        firNo,
        date: new Date("2026-11-02T00:00:00.000Z"),
        policeStation: "Geo Test Station",
        policeStationId: station._id,
        complaint: {
            complainantName: "Sensitive legacy complainant",
            complainantPhone: "5551234567",
            complaintText: "Private complaint text",
        },
        description: "Synthetic legacy coordinate fixture",
        crimeType: "Other",
        location: { address: "Private address", city: "Test City", state: "Test State", pincode: "000000" },
        registeredBy: officers.a._id,
        criminalIds: [criminal._id],
        status: "Open",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...coordinates,
    });
    await FIR.collection.insertMany([
        makeLegacyFIR("GEO-LEGACY-EDGE-A", { latitude: -90, longitude: 180 }),
        makeLegacyFIR("GEO-LEGACY-EDGE-B", { latitude: 90, longitude: -180 }),
        makeLegacyFIR("GEO-LEGACY-PARTIAL", { latitude: 12.5 }),
        makeLegacyFIR("GEO-LEGACY-OUT-OF-RANGE", { latitude: 90.01, longitude: 0 }),
        makeLegacyFIR("GEO-LEGACY-MISSING"),
    ]);
    await FIR.collection.insertOne({
        ...makeLegacyFIR("GEO-LEGACY-UNVERIFIED", { latitude: 12, longitude: 14 }),
        policeStationId: undefined,
    });

    const sourceRecords = await FIR.find({
        policeStationId: station._id,
        crimeType: "Other",
    }).lean();
    const response = await request(app)
        .get("/api/firs/map?crimeType=Other")
        .set(auth("a"));
    assert.equal(response.status, 200);
    assert.equal(response.body.data.totalRecords, sourceRecords.length);
    assert.equal(response.body.data.totalRecords, 5);
    assert.equal(response.body.data.mappedRecords, 2);
    assert.equal(response.body.data.unmappedRecords, 3);
    assert.equal(response.body.data.mappedRecords + response.body.data.unmappedRecords, sourceRecords.length);
    assert.deepEqual(
        response.body.data.records.map(({ firNo }) => firNo).sort(),
        ["GEO-LEGACY-EDGE-A", "GEO-LEGACY-EDGE-B"],
    );
    const allowedMarkerFields = new Set([
        "_id", "caseNo", "caseStatus", "crimeType", "date", "firNo", "latitude",
        "location", "longitude", "policeStation", "status",
    ]);
    assert.ok(response.body.data.records.every((record) =>
        Object.keys(record).every((key) => allowedMarkerFields.has(key)),
    ));
    assert.equal(JSON.stringify(response.body.data.records).includes("Sensitive legacy complainant"), false);
    assert.equal(JSON.stringify(response.body.data.records).includes("5551234567"), false);
    assert.equal(JSON.stringify(response.body.data.records).includes("Private address"), false);
    const missingCoordinates = await FIR.collection.findOne({ firNo: "GEO-LEGACY-MISSING" });
    const partialCoordinates = await FIR.collection.findOne({ firNo: "GEO-LEGACY-PARTIAL" });
    assert.equal(missingCoordinates.latitude, undefined);
    assert.equal(missingCoordinates.longitude, undefined);
    assert.equal(partialCoordinates.longitude, undefined);
});
