const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "police-station-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const PoliceStation = require("../models/PoliceStation");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const Criminal = require("../models/Criminal");

const password = "StationTests@123";
let mongo;
let app;
let adminToken;
let officerToken;
let inspectorToken;
let secondOfficerToken;
let officers;
let station;
let otherStation;
let inactiveStation;
let criminal;

const auth = (token) => ({ Authorization: ["Bearer", token].join(" ") });

const createAccount = async (username, rank, badgeNumber, stationRecord) => {
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
        officerId: `PS-${username}`,
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

const registrationPayload = (overrides = {}) => ({
    username: "station-register",
    email: "station-register@crms.test",
    batchNumber: "STR001",
    officerId: "PS-REGISTER-001",
    name: "Station Registration",
    rank: "constable",
    department: "Criminal Investigation",
    stationId: String(station._id),
    phoneNumber: "5550101001",
    address: "Synthetic registration address",
    joiningDate: "2022-01-01",
    ...overrides,
});

const firPayload = (firNo, overrides = {}) => ({
    firNo,
    date: "2026-10-12",
    policeStationId: String(station._id),
    complaint: { complainantName: "Synthetic complainant", complaintText: "Synthetic station test" },
    description: "Synthetic police station relationship test",
    crimeType: "Theft",
    location: { address: "Synthetic address", city: "Test City", state: "Test State", pincode: "000000" },
    criminalIds: [String(criminal._id)],
    status: "Open",
    ...overrides,
});

test.before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri("crms-police-stations"));
    app = createApp();
    await PoliceStation.init();
    await Officer.init();
    await FIR.init();

    station = await PoliceStation.create({ name: "  Central   Police Station ", code: "cps-01" });
    otherStation = await PoliceStation.create({ name: "West Police Station", code: "WPS-01" });
    inactiveStation = await PoliceStation.create({ name: "Inactive Station", code: "INACTIVE-01", isActive: false });

    const admin = await User.create({
        username: "station-system-admin",
        email: "station-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    const adminLogin = await request(app).post("/api/auth/login").send({ username: admin.username, password });
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.body.token;

    const officerA = await createAccount("station-officer-a", "si", "PSA001", station);
    const officerB = await createAccount("station-officer-b", "si", "PSB001", station);
    const inspector = await createAccount("station-inspector", "inspector", "PSI001", station);
    officers = { a: officerA.officer, b: officerB.officer, inspector: inspector.officer };
    officerToken = officerA.token;
    secondOfficerToken = officerB.token;
    inspectorToken = inspector.token;
    criminal = await Criminal.create({
        criminalId: "PS-CRIMINAL-001",
        fullName: "Synthetic person",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "Synthetic address",
        status: "active",
    });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});

test("police station master validates names and uniqueness and exposes only active station labels", async () => {
    const unauthenticatedList = await request(app).get("/api/police-stations");
    assert.equal(unauthenticatedList.status, 401);

    const officerList = await request(app).get("/api/police-stations").set(auth(officerToken));
    assert.equal(officerList.status, 403);

    const unauthenticatedCreate = await request(app).post("/api/police-stations").send({
        name: "Unauthorized Station",
        code: "UNAUTH-01",
    });
    assert.equal(unauthenticatedCreate.status, 401);

    const officerCreate = await request(app)
        .post("/api/police-stations")
        .set(auth(officerToken))
        .send({ name: "Officer Station", code: "OFFICER-01" });
    assert.equal(officerCreate.status, 403);

    const duplicateName = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "central police station", code: "CPS-02" });
    assert.equal(duplicateName.status, 409);

    const duplicateCode = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "Another Station", code: "cps-01" });
    assert.equal(duplicateCode.status, 409);

    const invalidName = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: " ", code: "EMPTY-01" });
    assert.equal(invalidName.status, 400);
    const controlCharacterName = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "Invalid\u0001Station", code: "CONTROL-01" });
    assert.equal(controlCharacterName.status, 400);

    const invalidCode = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "Invalid Code Station", code: "bad code" });
    assert.equal(invalidCode.status, 400);

    const activeList = await request(app).get("/api/police-stations/active");
    assert.equal(activeList.status, 200);
    assert.equal(activeList.body.count, 2);
    assert.equal(activeList.body.data.some((item) => item._id === String(inactiveStation._id)), false);
    assert.deepEqual(Object.keys(activeList.body.data[0]).sort(), ["_id", "name"]);
    assert.ok(activeList.body.data.some((item) => item._id === String(station._id)));

    const created = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "North Station", code: "NORTH-02", state: "Test State" });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.code, "NORTH-02");
    assert.equal(created.body.data.isActive, true);
    const persistedStation = await PoliceStation.findById(created.body.data._id);
    assert.ok(persistedStation);
    assert.equal(persistedStation.name, "North Station");
    assert.equal(persistedStation.isActive, true);

    const adminList = await request(app).get("/api/police-stations").set(auth(adminToken));
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.count, 4);
    assert.ok(adminList.body.data.some((item) => item._id === created.body.data._id));
    const refreshedDirectory = await request(app).get("/api/police-stations").set(auth(adminToken));
    assert.equal(refreshedDirectory.body.data.some((item) => item._id === created.body.data._id), true);
    await mongoose.disconnect();
    await mongoose.connect(mongo.getUri("crms-police-stations"));
    app = createApp();
    const directoryAfterDatabaseReconnect = await request(app).get("/api/police-stations").set(auth(adminToken));
    assert.equal(directoryAfterDatabaseReconnect.status, 200);
    assert.equal(directoryAfterDatabaseReconnect.body.data.some((item) => item._id === created.body.data._id), true);
    const activeAfterCreate = await request(app).get("/api/police-stations/active");
    assert.equal(activeAfterCreate.body.count, 3);
    assert.equal(activeAfterCreate.body.data.some((item) => item._id === created.body.data._id), true);

    const officerEdit = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}`)
        .set(auth(officerToken))
        .send({ name: "North Updated" });
    assert.equal(officerEdit.status, 403);

    const duplicateEdit = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}`)
        .set(auth(adminToken))
        .send({ name: station.name });
    assert.equal(duplicateEdit.status, 409);

    const duplicateCodeEdit = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}`)
        .set(auth(adminToken))
        .send({ code: station.code });
    assert.equal(duplicateCodeEdit.status, 409);

    const edited = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}`)
        .set(auth(adminToken))
        .send({ name: "North Updated", code: "NORTH-03", state: "Updated State" });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.name, "North Updated");
    assert.equal(edited.body.data.code, "NORTH-03");
    assert.equal(edited.body.data.state, "Updated State");

    const deactivate = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}/status`)
        .set(auth(adminToken))
        .send({ isActive: false });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.isActive, false);
    const inactiveNotInRegistration = await request(app).get("/api/police-stations/active");
    assert.equal(inactiveNotInRegistration.body.count, 2);
    assert.equal(inactiveNotInRegistration.body.data.some((item) => item._id === created.body.data._id), false);

    const officerStatus = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}/status`)
        .set(auth(officerToken))
        .send({ isActive: true });
    assert.equal(officerStatus.status, 403);

    const activate = await request(app)
        .patch(`/api/police-stations/${created.body.data._id}/status`)
        .set(auth(adminToken))
        .send({ isActive: true });
    assert.equal(activate.status, 200);
    assert.equal(activate.body.data.isActive, true);
    const activeAgain = await request(app).get("/api/police-stations/active");
    assert.equal(activeAgain.body.count, 3);
    assert.equal(activeAgain.body.data.some((item) => item._id === created.body.data._id), true);
});

test("officer registration stores an active canonical station directly and approval activates the account", async () => {
    const missingStation = await request(app).post("/api/auth/register").send(registrationPayload({
        stationId: undefined,
        station: "Central Police Station",
    }));
    assert.equal(missingStation.status, 400);
    assert.equal(missingStation.body.error, "STATION_REQUIRED");

    const invalidStationId = await request(app).post("/api/auth/register").send(registrationPayload({
        username: "station-invalid-id",
        email: "station-invalid-id@crms.test",
        batchNumber: "STI001",
        officerId: "PS-INVALID-ID",
        stationId: "not-an-object-id",
    }));
    assert.equal(invalidStationId.status, 400);
    assert.equal(invalidStationId.body.error, "INVALID_STATION_ID");

    const missingStationRecord = await request(app).post("/api/auth/register").send(registrationPayload({
        username: "station-missing-record",
        email: "station-missing-record@crms.test",
        batchNumber: "STM001",
        officerId: "PS-MISSING-RECORD",
        stationId: String(new mongoose.Types.ObjectId()),
    }));
    assert.equal(missingStationRecord.status, 404);

    const inactiveRegistration = await request(app).post("/api/auth/register").send(registrationPayload({
        username: "station-inactive-register",
        email: "station-inactive-register@crms.test",
        batchNumber: "STI002",
        officerId: "PS-INACTIVE-REGISTER",
        stationId: String(inactiveStation._id),
    }));
    assert.equal(inactiveRegistration.status, 400);
    assert.equal(inactiveRegistration.body.error, "INACTIVE_POLICE_STATION");

    const registered = await request(app).post("/api/auth/register").send(registrationPayload({
        station: "Untrusted client station name",
    }));
    assert.equal(registered.status, 201);
    assert.equal(registered.body.data.station, station.name);
    assert.equal(String(registered.body.data.stationId), String(station._id));
    const storedOfficer = await Officer.findById(registered.body.data.id);
    const registeredUser = await User.findById(storedOfficer.userId);
    assert.equal(String(storedOfficer.stationId), String(station._id));
    assert.equal(storedOfficer.station, station.name);
    assert.equal(storedOfficer.status, "inactive");
    assert.equal(registeredUser.status, "pending");
    assert.equal(registeredUser.isActive, false);
    const adminOfficerList = await request(app)
        .get("/api/officers?approvalStatus=pending")
        .set(auth(adminToken));
    const pendingOfficerRow = adminOfficerList.body.data.find((item) =>
        item._id === String(storedOfficer._id));
    assert.equal(pendingOfficerRow.stationName, station.name);
    assert.equal(pendingOfficerRow.stationAssignmentStatus, "Assigned");

    const unauthorizedApproval = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(officerToken));
    assert.equal(unauthorizedApproval.status, 403);
    const unauthorizedStationEdit = await request(app)
        .put(`/api/officers/${storedOfficer._id}`)
        .set(auth(inspectorToken))
        .send({ stationId: String(otherStation._id) });
    assert.equal(unauthorizedStationEdit.status, 403);
    assert.equal(unauthorizedStationEdit.body.error, "INSUFFICIENT_PERMISSIONS");

    await Officer.collection.updateOne({ _id: storedOfficer._id }, { $unset: { stationId: "" } });
    const approvalWithoutStation = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approvalWithoutStation.status, 400);
    assert.equal(approvalWithoutStation.body.error, "STATION_ASSIGNMENT_INVALID");
    assert.equal((await User.findById(registeredUser._id)).status, "pending");
    assert.equal((await User.findById(registeredUser._id)).isActive, false);

    await Officer.collection.updateOne(
        { _id: storedOfficer._id },
        { $set: { stationId: new mongoose.Types.ObjectId() } },
    );
    const approvalWithMissingStation = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approvalWithMissingStation.status, 400);
    assert.equal(approvalWithMissingStation.body.error, "STATION_ASSIGNMENT_INVALID");
    assert.equal((await User.findById(registeredUser._id)).status, "pending");

    await Officer.collection.updateOne({ _id: storedOfficer._id }, { $set: { stationId: inactiveStation._id } });
    const approvalWithInactiveStation = await request(app).patch(`/api/officers/${storedOfficer._id}/approve`).set(auth(adminToken));
    assert.equal(approvalWithInactiveStation.status, 400);
    assert.equal(approvalWithInactiveStation.body.error, "STATION_ASSIGNMENT_INVALID");
    assert.equal((await User.findById(registeredUser._id)).status, "pending");
    await Officer.collection.updateOne({ _id: storedOfficer._id }, { $set: { stationId: station._id } });
    const prematureActivation = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(prematureActivation.status, 409);
    assert.equal(prematureActivation.body.error, "OFFICER_NOT_APPROVED");

    const removedManualAssignment = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(otherStation._id) });
    assert.equal(removedManualAssignment.status, 200);
    await request(app).patch(`/api/officers/${storedOfficer._id}/station`).set(auth(adminToken)).send({ stationId: String(station._id) });

    const pendingLogin = await request(app).post("/api/auth/login").send({
        username: "station-register",
        password: "STR001",
    });
    assert.equal(pendingLogin.status, 403);

    const approved = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approved.status, 200);
    assert.equal(String(approved.body.data.stationId), String(station._id));
    assert.equal(approved.body.data.station, station.name);
    const afterApproval = await Officer.findById(storedOfficer._id);
    assert.equal(afterApproval.status, "active");
    assert.equal(String(afterApproval.stationId), String(station._id));
    assert.equal(afterApproval.station, station.name);
    assert.equal((await User.findById(registeredUser._id)).status, "approved");
    assert.equal((await User.findById(registeredUser._id)).isActive, true);
    const login = await request(app).post("/api/auth/login").send({
        username: "station-register",
        password: "STR001",
    });
    assert.equal(login.status, 200);

    const rejectedRegistration = await request(app).post("/api/auth/register").send(registrationPayload({
        username: "station-rejected",
        email: "station-rejected@crms.test",
        batchNumber: "STR002",
        officerId: "PS-REJECTED",
    }));
    assert.equal(rejectedRegistration.status, 201);
    const rejected = await request(app)
        .patch(`/api/officers/${rejectedRegistration.body.data.id}/reject`)
        .set(auth(adminToken));
    assert.equal(rejected.status, 200);
    const rejectedOfficer = await Officer.findById(rejectedRegistration.body.data.id);
    assert.equal(String(rejectedOfficer.stationId), String(station._id));
    const rejectedUser = await User.findById(rejectedOfficer.userId);
    assert.equal(rejectedUser.status, "rejected");
    assert.equal(rejectedUser.isActive, false);
});

test("officer activation requires an existing active station assigned by an administrator", async () => {
    const user = await User.create({
        username: "station-activation-legacy",
        email: "station-activation-legacy@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: false,
    });
    const legacyOfficer = await Officer.create({
        userId: user._id,
        officerId: "PS-ACTIVATION-LEGACY",
        badgeNumber: "PSA002",
        name: "Legacy activation officer",
        rank: "constable",
        department: "Criminal Investigation",
        station: "Legacy station text",
        phoneNumber: "5550101003",
        address: "Synthetic legacy address",
        joiningDate: "2020-01-01",
        status: "inactive",
    });

    const activationWithoutStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activationWithoutStation.status, 400);
    assert.equal(activationWithoutStation.body.error, "STATION_ASSIGNMENT_REQUIRED");

    await Officer.collection.updateOne(
        { _id: legacyOfficer._id },
        { $set: { stationId: new mongoose.Types.ObjectId() } },
    );
    const activationWithMissingStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activationWithMissingStation.status, 400);
    assert.equal(activationWithMissingStation.body.error, "STATION_ASSIGNMENT_INVALID");

    await Officer.collection.updateOne(
        { _id: legacyOfficer._id },
        { $set: { stationId: inactiveStation._id } },
    );
    const activationWithInactiveStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activationWithInactiveStation.status, 400);
    assert.equal(activationWithInactiveStation.body.error, "STATION_ASSIGNMENT_INVALID");

    const unauthorizedAssignment = await request(app)
        .put(`/api/officers/${legacyOfficer._id}`)
        .set(auth(officerToken))
        .send({ stationId: String(station._id) });
    assert.equal(unauthorizedAssignment.status, 403);
    assert.equal(unauthorizedAssignment.body.error, "INSUFFICIENT_PERMISSIONS");

    const unauthorizedStationCorrection = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/station`)
        .set(auth(officerToken))
        .send({ stationId: String(station._id) });
    assert.equal(unauthorizedStationCorrection.status, 403);

    await Officer.collection.updateOne(
        { _id: legacyOfficer._id },
        { $unset: { stationId: "" } },
    );
    const stillReadable = await Officer.findById(legacyOfficer._id);
    assert.equal(stillReadable.station, "Legacy station text");
    assert.equal(stillReadable.stationId, undefined);

    const activationWithStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activationWithStation.status, 400);

    await Officer.collection.updateOne({ _id: legacyOfficer._id }, { $set: { rank: "Inspector" } });
    const correctionWithInactiveStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(inactiveStation._id) });
    assert.equal(correctionWithInactiveStation.status, 400);
    const correctionWithMissingStation = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(new mongoose.Types.ObjectId()) });
    assert.equal(correctionWithMissingStation.status, 404);

    const legacyCorrection = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(station._id) });
    assert.equal(legacyCorrection.status, 200);
    assert.equal(String(legacyCorrection.body.data.stationId), String(station._id));
    const correctedLegacyOfficer = await Officer.findById(legacyOfficer._id);
    assert.equal(String(correctedLegacyOfficer.stationId), String(station._id));
    assert.equal(correctedLegacyOfficer.station, station.name);
    assert.equal(correctedLegacyOfficer.rank, "Inspector");
    assert.equal(correctedLegacyOfficer.status, "inactive");
    const unchangedUser = await User.findById(user._id);
    assert.equal(unchangedUser.status, "approved");
    assert.equal(unchangedUser.isActive, false);
    const activated = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activated.status, 200);
    assert.equal((await Officer.findById(legacyOfficer._id)).status, "active");
    assert.equal((await User.findById(user._id)).isActive, true);
});

test("FIR creation requires the officer's approved station and registration details remain immutable", async () => {
    const managerCannotReassign = await request(app)
        .put(`/api/officers/${officers.a._id}`)
        .set(auth(inspectorToken))
        .send({
            station: "Forged station",
            stationId: String(inactiveStation._id),
            requestedStationId: String(inactiveStation._id),
        });
    assert.equal(managerCannotReassign.status, 403);
    assert.equal(managerCannotReassign.body.error, "INSUFFICIENT_PERMISSIONS");
    const removedManualAssignment = await request(app)
        .patch(`/api/officers/${officers.a._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(inactiveStation._id) });
    assert.equal(removedManualAssignment.status, 400);
    assert.equal(String((await Officer.findById(officers.a._id)).stationId), String(station._id));

    const linkedFir = await request(app)
        .post("/api/firs")
        .set(auth(officerToken))
        .send(firPayload("PS-LINKED-FIR", { policeStation: "Mismatched text" }));
    assert.equal(linkedFir.status, 201);
    assert.equal(linkedFir.body.data.policeStation, station.name);
    assert.equal(String(linkedFir.body.data.policeStationId), String(station._id));

    const otherStationFir = await request(app)
        .post("/api/firs")
        .set(auth(officerToken))
        .send(firPayload("PS-OTHER-STATION-FIR", { policeStationId: String(otherStation._id) }));
    assert.equal(otherStationFir.status, 403);
    assert.equal(otherStationFir.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");
    assert.equal(await FIR.exists({ firNo: "PS-OTHER-STATION-FIR" }), null);

    const invalidFirStation = await request(app)
        .post("/api/firs")
        .set(auth(officerToken))
        .send(firPayload("PS-INVALID-FIR", { policeStationId: String(new mongoose.Types.ObjectId()) }));
    assert.equal(invalidFirStation.status, 404);
    assert.equal(await FIR.exists({ firNo: "PS-INVALID-FIR" }), null);

    const noCanonicalStation = await request(app)
        .post("/api/firs")
        .set(auth(officerToken))
        .send(firPayload("PS-NO-STATION-FIR", { policeStationId: undefined, policeStation: "Legacy FIR Station" }));
    assert.equal(noCanonicalStation.status, 400);
    assert.equal(noCanonicalStation.body.error, "POLICE_STATION_REFERENCE_REQUIRED");
    assert.equal(await FIR.exists({ firNo: "PS-NO-STATION-FIR" }), null);

    const originalOtherStationFir = await FIR.create({
        ...firPayload("PS-ORIGINAL-OTHER-STATION-FIR", {
            policeStation: otherStation.name,
            policeStationId: otherStation._id,
        }),
        registeredBy: officers.a._id,
    });
    const changeToAssignedStation = await request(app)
        .put(`/api/firs/${originalOtherStationFir._id}`)
        .set(auth(officerToken))
        .send({ policeStationId: String(station._id) });
    assert.equal(changeToAssignedStation.status, 405);
    assert.equal(changeToAssignedStation.body.error, "FIR_IMMUTABLE");
    const unchangedOriginal = await FIR.findById(originalOtherStationFir._id);
    assert.equal(String(unchangedOriginal.policeStationId), String(otherStation._id));
    assert.equal(unchangedOriginal.policeStation, otherStation.name);

    const legacyFir = await FIR.create({
        ...firPayload("PS-LEGACY-STATION-FIR", {
            policeStation: "Legacy FIR Station",
            policeStationId: undefined,
        }),
        registeredBy: officers.a._id,
    });
    const changeLegacyText = await request(app)
        .put(`/api/firs/${legacyFir._id}`)
        .set(auth(officerToken))
        .send({ policeStation: "Forged station text" });
    assert.equal(changeLegacyText.status, 405);
    assert.equal(changeLegacyText.body.error, "FIR_IMMUTABLE");
    const assignLegacyReference = await request(app)
        .put(`/api/firs/${legacyFir._id}`)
        .set(auth(officerToken))
        .send({ policeStationId: String(station._id) });
    assert.equal(assignLegacyReference.status, 405);
    assert.equal(assignLegacyReference.body.error, "FIR_IMMUTABLE");
    const unchangedLegacy = await FIR.findById(legacyFir._id);
    assert.equal(unchangedLegacy.policeStation, "Legacy FIR Station");
    assert.equal(unchangedLegacy.policeStationId, undefined);

    const unrelatedEdit = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ description: "Updated without changing station" });
    assert.equal(unrelatedEdit.status, 405);
    const linkedAfterUnrelatedEdit = await FIR.findById(linkedFir.body.data._id);
    assert.equal(String(linkedAfterUnrelatedEdit.policeStationId), String(station._id));
    assert.equal(linkedAfterUnrelatedEdit.policeStation, station.name);

    const noStationChanges = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken));
    assert.equal(noStationChanges.status, 405);

    const inaccessibleFir = await request(app)
        .get(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(secondOfficerToken));
    assert.equal(inaccessibleFir.status, 403);

    const otherStationUpdate = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ policeStationId: String(otherStation._id) });
    assert.equal(otherStationUpdate.status, 405);
    assert.equal(otherStationUpdate.body.error, "FIR_IMMUTABLE");

    const textStationSpoof = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ policeStation: "Another station" });
    assert.equal(textStationSpoof.status, 405);
    assert.equal(textStationSpoof.body.error, "FIR_IMMUTABLE");

    const caseRecord = await Case.create({
        caseNo: "PS-LINKED-CASE",
        firId: linkedFir.body.data._id,
        assignedOfficerIds: [officers.a._id],
        criminalIds: [criminal._id],
        title: "Synthetic station case",
        description: "Private case detail",
        startDate: "2026-10-12",
        status: "Open",
        priority: "Medium",
    });
    const inaccessibleCase = await request(app)
        .get(`/api/cases/${caseRecord._id}`)
        .set(auth(secondOfficerToken));
    assert.equal(inaccessibleCase.status, 403);

    const evidence = await Evidence.create({
        evidenceId: "PS-LINKED-EVIDENCE",
        caseId: caseRecord._id,
        investigationRound: 1,
        type: "Physical",
        description: "Synthetic access-control evidence",
        collectedBy: officers.a._id,
        collectionDate: "2026-10-12",
        location: "Synthetic evidence location",
        status: "Collected",
    });
    const assignedEvidence = await request(app)
        .get(`/api/evidence/${evidence._id}`)
        .set(auth(officerToken));
    assert.equal(assignedEvidence.status, 200);
    const inaccessibleEvidence = await request(app)
        .get(`/api/evidence/${evidence._id}`)
        .set(auth(secondOfficerToken));
    assert.equal(inaccessibleEvidence.status, 403);

    const unassignedUser = await User.create({
        username: "station-unassigned-officer",
        email: "station-unassigned-officer@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const unassignedOfficer = await Officer.create({
        userId: unassignedUser._id,
        officerId: "PS-UNASSIGNED",
        badgeNumber: "PSU001",
        name: "Unassigned Officer",
        rank: "si",
        department: "Criminal Investigation",
        station: "Legacy request only",
        phoneNumber: "5550101002",
        address: "Synthetic address",
        joiningDate: "2020-01-01",
        status: "active",
    });
    assert.equal(unassignedOfficer.stationId, undefined);
    const unassignedLogin = await request(app)
        .post("/api/auth/login")
        .send({ username: unassignedUser.username, password });
    assert.equal(unassignedLogin.status, 200);
    const unassignedCreate = await request(app)
        .post("/api/firs")
        .set(auth(unassignedLogin.body.token))
        .send(firPayload("PS-UNASSIGNED-FIR"));
    assert.equal(unassignedCreate.status, 403);
    assert.equal(unassignedCreate.body.error, "STATION_ASSIGNMENT_REQUIRED");
});
