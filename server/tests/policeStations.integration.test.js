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
    assert.equal(activeList.body.data.some((item) => item._id === String(inactiveStation._id)), false);
    assert.deepEqual(Object.keys(activeList.body.data[0]).sort(), ["_id", "name"]);
    assert.ok(activeList.body.data.some((item) => item._id === String(station._id)));

    const created = await request(app)
        .post("/api/police-stations")
        .set(auth(adminToken))
        .send({ name: "North Station", code: "NORTH-02", state: "Test State" });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.code, "NORTH-02");
});

test("officer registration requests an active canonical station and approval confirms it", async () => {
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
    assert.equal(registered.body.data.stationId, null);
    assert.equal(String(registered.body.data.requestedStationId), String(station._id));
    const storedOfficer = await Officer.findById(registered.body.data.id);
    const registeredUser = await User.findById(storedOfficer.userId);
    assert.equal(storedOfficer.stationId, undefined);
    assert.equal(String(storedOfficer.requestedStationId), String(station._id));
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
    assert.equal(pendingOfficerRow.stationAssignmentStatus, "Requested");

    const unauthorizedApproval = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(officerToken));
    assert.equal(unauthorizedApproval.status, 403);
    const unauthorizedStationEdit = await request(app)
        .put(`/api/officers/${storedOfficer._id}`)
        .set(auth(inspectorToken))
        .send({ requestedStationId: String(otherStation._id) });
    assert.equal(unauthorizedStationEdit.status, 403);
    assert.equal(unauthorizedStationEdit.body.error, "STATION_ASSIGNMENT_DENIED");

    await Officer.collection.updateOne(
        { _id: storedOfficer._id },
        { $unset: { requestedStationId: "" } },
    );
    const approvalWithoutRequest = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approvalWithoutRequest.status, 400);
    assert.equal(approvalWithoutRequest.body.error, "REQUESTED_STATION_REQUIRED");
    assert.equal((await User.findById(registeredUser._id)).status, "pending");
    assert.equal((await User.findById(registeredUser._id)).isActive, false);

    await Officer.collection.updateOne(
        { _id: storedOfficer._id },
        { $set: { requestedStationId: new mongoose.Types.ObjectId() } },
    );
    const approvalWithMissingStation = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approvalWithMissingStation.status, 400);
    assert.equal(approvalWithMissingStation.body.error, "REQUESTED_STATION_INVALID");

    await Officer.collection.updateOne(
        { _id: storedOfficer._id },
        { $set: { requestedStationId: inactiveStation._id } },
    );
    const approvalWithInactiveStation = await request(app)
        .patch(`/api/officers/${storedOfficer._id}/approve`)
        .set(auth(adminToken));
    assert.equal(approvalWithInactiveStation.status, 400);
    assert.equal(approvalWithInactiveStation.body.error, "REQUESTED_STATION_INVALID");
    assert.equal((await Officer.findById(storedOfficer._id)).stationId, undefined);
    assert.equal((await User.findById(registeredUser._id)).status, "pending");

    await Officer.collection.updateOne(
        { _id: storedOfficer._id },
        { $set: { requestedStationId: station._id } },
    );
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
    assert.equal(removedManualAssignment.status, 404);

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
    assert.equal(afterApproval.requestedStationId, undefined);
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
    assert.equal(rejectedOfficer.stationId, undefined);
    assert.equal(String(rejectedOfficer.requestedStationId), String(station._id));
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
        .send({ requestedStationId: String(station._id) });
    assert.equal(unauthorizedAssignment.status, 403);
    assert.equal(unauthorizedAssignment.body.error, "STATION_ASSIGNMENT_DENIED");

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

    await Officer.collection.updateOne(
        { _id: legacyOfficer._id },
        { $set: { stationId: station._id, station: station.name } },
    );
    const activated = await request(app)
        .patch(`/api/officers/${legacyOfficer._id}/status`)
        .set(auth(adminToken))
        .send({ accountStatus: "active" });
    assert.equal(activated.status, 200);
    assert.equal((await Officer.findById(legacyOfficer._id)).status, "active");
    assert.equal((await User.findById(user._id)).isActive, true);
});

test("FIR creation and edits require the officer's approved station without weakening record authorization", async () => {
    const managerCannotReassign = await request(app)
        .put(`/api/officers/${officers.a._id}`)
        .set(auth(inspectorToken))
        .send({
            station: "Forged station",
            stationId: String(inactiveStation._id),
            requestedStationId: String(inactiveStation._id),
        });
    assert.equal(managerCannotReassign.status, 403);
    assert.equal(managerCannotReassign.body.error, "STATION_ASSIGNMENT_DENIED");
    const removedManualAssignment = await request(app)
        .patch(`/api/officers/${officers.a._id}/station`)
        .set(auth(adminToken))
        .send({ stationId: String(inactiveStation._id) });
    assert.equal(removedManualAssignment.status, 404);
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
    assert.equal(changeToAssignedStation.status, 403);
    assert.equal(changeToAssignedStation.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");
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
    assert.equal(changeLegacyText.status, 403);
    assert.equal(changeLegacyText.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");
    const assignLegacyReference = await request(app)
        .put(`/api/firs/${legacyFir._id}`)
        .set(auth(officerToken))
        .send({ policeStationId: String(station._id) });
    assert.equal(assignLegacyReference.status, 403);
    assert.equal(assignLegacyReference.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");
    const unchangedLegacy = await FIR.findById(legacyFir._id);
    assert.equal(unchangedLegacy.policeStation, "Legacy FIR Station");
    assert.equal(unchangedLegacy.policeStationId, undefined);

    const unrelatedEdit = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ description: "Updated without changing station" });
    assert.equal(unrelatedEdit.status, 200);
    const linkedAfterUnrelatedEdit = await FIR.findById(linkedFir.body.data._id);
    assert.equal(String(linkedAfterUnrelatedEdit.policeStationId), String(station._id));
    assert.equal(linkedAfterUnrelatedEdit.policeStation, station.name);

    const noStationChanges = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken));
    assert.equal(noStationChanges.status, 400);

    const inaccessibleFir = await request(app)
        .get(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(secondOfficerToken));
    assert.equal(inaccessibleFir.status, 403);

    const otherStationUpdate = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ policeStationId: String(otherStation._id) });
    assert.equal(otherStationUpdate.status, 403);
    assert.equal(otherStationUpdate.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");

    const textStationSpoof = await request(app)
        .put(`/api/firs/${linkedFir.body.data._id}`)
        .set(auth(officerToken))
        .send({ policeStation: "Another station" });
    assert.equal(textStationSpoof.status, 403);
    assert.equal(textStationSpoof.body.error, "POLICE_STATION_ASSIGNMENT_DENIED");

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
