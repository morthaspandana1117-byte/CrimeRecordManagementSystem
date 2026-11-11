const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "core-records-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Report = require("../models/Report");
const PoliceStation = require("../models/PoliceStation");

let mongoServer;
let app;
let tokens;
let officers;
let criminal;
let station;

const auth = (key) => ({ Authorization: `Bearer ${tokens[key]}` });

const firPayload = (overrides = {}) => ({
    firNo: "CORE-FIR-001",
    date: "2026-09-01",
    policeStation: "Core Station",
    policeStationId: String(station._id),
    complaint: {
        complainantName: "Core Complainant",
        complaintText: "A bicycle was stolen outside the market.",
    },
    description: "Bicycle theft reported by complainant",
    crimeType: "Theft",
    location: {
        address: "1 Market Road",
        city: "Core City",
        state: "Core State",
        pincode: "500001",
    },
    criminalIds: [String(criminal._id)],
    ...overrides,
});

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongoServer.getUri("crms-core-records"));
    station = await PoliceStation.create({ name: "Core Station", code: "CORE-01" });
    // Duplicate firNo detection relies on the unique index being built.
    await FIR.init();
    app = createApp();

    const passwordHash = await bcrypt.hash("CoreRecords@123", 10);
    tokens = {};
    officers = {};
    for (const [key, role, rank, badgeNumber] of [
        ["admin", "system_admin", null, null],
        ["officerA", "officer", "si", "CRA001"],
        ["officerB", "officer", "si", "CRB001"],
        ["inspector", "officer", "inspector", "CRI001"],
    ]) {
        const user = await User.create({
            username: `core-${key}`,
            email: `core-${key}@crms.test`,
            passwordHash,
            role,
            status: "approved",
            isActive: true,
        });
        if (rank) {
            officers[key] = await Officer.create({
                userId: user._id,
                officerId: `CORE-${key}`,
                badgeNumber,
                name: `Core ${key}`,
                rank,
                department: "Criminal Investigation",
                station: "Core Station",
                stationId: station._id,
                phoneNumber: "5550000000",
                address: "Core Street",
                joiningDate: "2020-01-01",
                status: "active",
            });
        }

        const login = await request(app)
            .post("/api/auth/login")
            .send({ username: user.username, password: "CoreRecords@123" });
        assert.equal(login.status, 200);
        tokens[key] = login.body.token;
    }

    criminal = await Criminal.create({
        criminalId: "CORE-CRIM-000",
        fullName: "Fixture Suspect",
        dateOfBirth: "1990-01-01",
        gender: "Male",
        address: "Fixture Address",
        status: "active",
    });
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("FIR registration supports zero or multiple suspected criminals and rejects invalid IDs", async () => {
    const unknownSuspect = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-UNKNOWN", crimeType: "Other", criminalIds: [] }));
    assert.equal(unknownSuspect.status, 201);
    assert.deepEqual(unknownSuspect.body.data.criminalIds, []);
    const storedUnknown = await FIR.findById(unknownSuspect.body.data._id).lean();
    assert.deepEqual(storedUnknown.criminalIds, []);

    const secondCriminal = await Criminal.create({
        criminalId: "CORE-CRIM-002",
        fullName: "Second Fixture Suspect",
        dateOfBirth: "1992-02-02",
        gender: "Female",
        address: "Second Fixture Address",
        status: "active",
    });
    const multiple = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-MULTI", crimeType: "Other", criminalIds: [String(criminal._id), String(secondCriminal._id)] }));
    assert.equal(multiple.status, 201);
    assert.equal(multiple.body.data.criminalIds.length, 2);

    const invalid = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-BAD-CRIMINAL", criminalIds: [String(new mongoose.Types.ObjectId())] }));
    assert.equal(invalid.status, 400);
    assert.equal(await FIR.exists({ firNo: "CORE-FIR-BAD-CRIMINAL" }), null);

    const independentDescriptions = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-DESCRIPTIONS", crimeType: "Other", criminalIds: [], complaint: { complainantName: "Witness", complaintText: "The witness reported a red bicycle taken at noon." }, description: "Police summary: likely theft near the market entrance." }));
    assert.equal(independentDescriptions.status, 201);
    const storedDescriptions = await FIR.findById(independentDescriptions.body.data._id).lean();
    assert.equal(storedDescriptions.complaint.complaintText, "The witness reported a red bicycle taken at noon.");
    assert.equal(storedDescriptions.description, "Police summary: likely theft near the market entrance.");
    assert.notEqual(storedDescriptions.complaint.complaintText, storedDescriptions.description);

    await FIR.deleteMany({ firNo: { $in: ["CORE-FIR-UNKNOWN", "CORE-FIR-MULTI", "CORE-FIR-DESCRIPTIONS"] } });
    await Criminal.deleteOne({ _id: secondCriminal._id });
});

test("FIR create, filtered list, retrieval, immutable registration details, and status change persist through the API", async () => {
    const created = await request(app).post("/api/firs").set(auth("officerA")).send(firPayload());
    assert.equal(created.status, 201);
    assert.equal(created.body.data.status, "Open", "status defaults to Open");
    assert.deepEqual(created.body.data.criminalIds.map((item) => item._id), [String(criminal._id)]);
    assert.equal(String(created.body.data.registeredBy._id), String(officers.officerA._id), "registeredBy is server-resolved");
    const firId = created.body.data._id;
    assert.ok(await FIR.exists({ _id: firId, firNo: "CORE-FIR-001" }));

    const second = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-002", crimeType: "Fraud", description: "Online payment fraud" }));
    assert.equal(second.status, 201);

    const incomplete = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send({ firNo: "CORE-FIR-BAD" });
    assert.equal(incomplete.status, 400);
    assert.equal(await FIR.exists({ firNo: "CORE-FIR-BAD" }), null);

    const filtered = await request(app)
        .get("/api/firs?crimeType=Theft&status=Open&page=1&limit=5")
        .set(auth("officerA"));
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.data.map((fir) => fir.firNo), ["CORE-FIR-001"]);
    assert.equal(filtered.body.pagination.totalRecords, 1);

    const searched = await request(app).get("/api/firs?search=payment").set(auth("officerA"));
    assert.equal(searched.status, 200);
    assert.deepEqual(searched.body.data.map((fir) => fir.firNo), ["CORE-FIR-002"]);

    const paged = await request(app).get("/api/firs?limit=1&page=2").set(auth("officerA"));
    assert.equal(paged.status, 200);
    assert.equal(paged.body.count, 1);
    assert.equal(paged.body.pagination.totalRecords, 2);
    assert.equal(paged.body.pagination.totalPages, 2);

    const badStatusFilter = await request(app).get("/api/firs?status=Archived").set(auth("officerA"));
    assert.equal(badStatusFilter.status, 400);
    assert.equal(badStatusFilter.body.error, "INVALID_FIR_STATUS");
    const badLimit = await request(app).get("/api/firs?limit=101").set(auth("officerA"));
    assert.equal(badLimit.status, 400);
    assert.equal(badLimit.body.error, "INVALID_LIMIT");

    const fetched = await request(app).get(`/api/firs/${firId}`).set(auth("officerA"));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.firNo, "CORE-FIR-001");
    assert.equal(fetched.body.data.criminalIds[0].criminalId, "CORE-CRIM-000");

    const originalComplaint = JSON.stringify((await FIR.findById(firId)).complaint.toObject());
    const updated = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("officerA"))
        .send({ description: "Bicycle theft with CCTV footage available", complaint: { complaintText: "Forged" }, status: "Closed" });
    assert.equal(updated.status, 405);
    assert.equal(updated.body.error, "FIR_IMMUTABLE");
    const storedAfterUpdate = await FIR.findById(firId);
    assert.equal(storedAfterUpdate.description, "Bicycle theft reported by complainant");
    assert.equal(JSON.stringify(storedAfterUpdate.complaint.toObject()), originalComplaint);
    assert.equal(storedAfterUpdate.status, "Open");
    assert.equal(String(storedAfterUpdate.registeredBy), String(officers.officerA._id));

    const statusChanged = await request(app)
        .patch(`/api/firs/${firId}/status`)
        .set(auth("officerA"))
        .send({ status: "Under Investigation" });
    assert.equal(statusChanged.status, 200);
    assert.equal((await FIR.findById(firId)).status, "Under Investigation");

    const massAssignment = await request(app)
        .patch(`/api/firs/${firId}/status`)
        .set(auth("officerA"))
        .send({ status: "Closed", description: "Attempted indirect edit" });
    assert.equal(massAssignment.status, 400);
    assert.equal(massAssignment.body.error, "INVALID_FIR_STATUS_UPDATE");
    assert.equal((await FIR.findById(firId)).description, "Bicycle theft reported by complainant");

    const badStatus = await request(app)
        .patch(`/api/firs/${firId}/status`)
        .set(auth("officerA"))
        .send({ status: "Archived" });
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.body.error, "INVALID_FIR_STATUS");
    assert.equal(badStatus.body.message, "status must be one of: Open, Registered, Under Investigation, Charge Sheet Filed, Closed");
    assert.equal((await FIR.findById(firId)).status, "Under Investigation");
});

test("FIR access is scoped to the registering investigating officer and duplicate FIR numbers conflict", async () => {
    const created = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-SCOPE" }));
    assert.equal(created.status, 201);
    const firId = created.body.data._id;

    const otherList = await request(app).get("/api/firs?limit=100").set(auth("officerB"));
    assert.equal(otherList.status, 200);
    assert.ok(!otherList.body.data.some((fir) => fir.firNo === "CORE-FIR-SCOPE"));

    const otherGet = await request(app).get(`/api/firs/${firId}`).set(auth("officerB"));
    assert.equal(otherGet.status, 403);
    assert.equal(otherGet.body.error, "FIR_ACCESS_DENIED");

    const otherUpdate = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("officerB"))
        .send({ description: "Unauthorized edit" });
    assert.equal(otherUpdate.status, 405);
    assert.equal(otherUpdate.body.error, "FIR_IMMUTABLE");

    const otherStatus = await request(app)
        .patch(`/api/firs/${firId}/status`)
        .set(auth("officerB"))
        .send({ status: "Closed" });
    assert.equal(otherStatus.status, 403);
    assert.equal(otherStatus.body.error, "FIR_ACCESS_DENIED");

    const stored = await FIR.findById(firId);
    assert.equal(stored.description, "Bicycle theft reported by complainant");
    assert.equal(stored.status, "Open");

    const inspectorGet = await request(app).get(`/api/firs/${firId}`).set(auth("inspector"));
    assert.equal(inspectorGet.status, 200);

    const duplicate = await request(app)
        .post("/api/firs")
        .set(auth("officerB"))
        .send(firPayload({ firNo: "CORE-FIR-SCOPE" }));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "DUPLICATE_RECORD");
    assert.equal(await FIR.countDocuments({ firNo: "CORE-FIR-SCOPE" }), 1);
});

test("all roles are unable to edit FIR registration details, while authorized reads still work", async () => {
    const created = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .send(firPayload({ firNo: "CORE-FIR-OWNER" }));
    assert.equal(created.status, 201);
    const firId = created.body.data._id;
    const ownerId = String(officers.officerA._id);
    const original = await FIR.findById(firId).lean();
    const seniorEdit = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("inspector"))
        .send({ description: "Inspector reviewed the complaint" });
    assert.equal(seniorEdit.status, 405);
    assert.equal(seniorEdit.body.error, "FIR_IMMUTABLE");

    const adminEdit = await request(app).put(`/api/firs/${firId}`).set(auth("admin")).send({ description: "Admin edit" });
    assert.ok([403, 405].includes(adminEdit.status));

    const unauthenticatedEdit = await request(app).put(`/api/firs/${firId}`).send({ description: "Anonymous edit" });
    assert.equal(unauthenticatedEdit.status, 401);
    const storedAfterEdits = await FIR.findById(firId).lean();
    assert.equal(storedAfterEdits.description, original.description);
    assert.equal(String(storedAfterEdits.registeredBy), String(original.registeredBy));

    const ownerGet = await request(app).get(`/api/firs/${firId}`).set(auth("officerA"));
    assert.equal(ownerGet.status, 200);
    assert.equal(ownerGet.body.data.description, original.description);
    const ownerList = await request(app).get("/api/firs?search=CORE-FIR-OWNER").set(auth("officerA"));
    assert.deepEqual(ownerList.body.data.map((fir) => fir.firNo), ["CORE-FIR-OWNER"]);
    const ownerEdit = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("officerA"))
        .send({ description: "Owner follow-up" });
    assert.equal(ownerEdit.status, 405);

    const explicitTakeover = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("inspector"))
        .send({ registeredBy: String(officers.inspector._id), description: "Takeover attempt" });
    assert.equal(explicitTakeover.status, 405);
    assert.equal(explicitTakeover.body.error, "FIR_IMMUTABLE");
    const storedAfterTakeover = await FIR.findById(firId);
    assert.equal(String(storedAfterTakeover.registeredBy), ownerId);
    assert.equal(storedAfterTakeover.description, original.description);

    const sameOwner = await request(app)
        .put(`/api/firs/${firId}`)
        .set(auth("inspector"))
        .send({ registeredBy: ownerId, description: "Inspector confirmed owner" });
    assert.equal(sameOwner.status, 405);
    assert.equal(String((await FIR.findById(firId)).registeredBy), ownerId);

    const otherOfficerGet = await request(app).get(`/api/firs/${firId}`).set(auth("officerB"));
    assert.equal(otherOfficerGet.status, 403, "unrelated investigating officers remain denied");
});

test("criminal records can be listed, retrieved, and status-updated, and duplicate criminal IDs conflict", async () => {
    const payload = {
        criminalId: "CORE-CRIM-101",
        fullName: "Ravi Wanted",
        dateOfBirth: "1985-05-05",
        gender: "Male",
        address: "Unknown Street",
        status: "wanted",
    };
    const created = await request(app).post("/api/criminals").set(auth("officerA")).send(payload);
    assert.equal(created.status, 201);
    const criminalId = created.body.data._id;

    const duplicate = await request(app)
        .post("/api/criminals")
        .set(auth("officerB"))
        .send({ ...payload, fullName: "Different Person" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "CRIMINAL_ID_ALREADY_EXISTS");
    assert.equal(await Criminal.countDocuments({ criminalId: "CORE-CRIM-101" }), 1);

    const listed = await request(app).get("/api/criminals?status=wanted&search=ravi").set(auth("officerB"));
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.map((record) => record.criminalId), ["CORE-CRIM-101"]);
    assert.equal(listed.body.pagination.totalRecords, 1);

    const badFilter = await request(app).get("/api/criminals?status=escaped").set(auth("officerA"));
    assert.equal(badFilter.status, 400);
    assert.equal(badFilter.body.error, "INVALID_CRIMINAL_STATUS");

    const fetched = await request(app).get(`/api/criminals/${criminalId}`).set(auth("officerA"));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.fullName, "Ravi Wanted");

    const arrested = await request(app)
        .patch(`/api/criminals/${criminalId}/status`)
        .set(auth("officerA"))
        .send({ status: "Arrested" });
    assert.equal(arrested.status, 200);
    assert.equal((await Criminal.findById(criminalId)).status, "arrested");

    const badStatus = await request(app)
        .patch(`/api/criminals/${criminalId}/status`)
        .set(auth("officerA"))
        .send({ status: "escaped" });
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.body.error, "INVALID_CRIMINAL_STATUS");
    assert.equal((await Criminal.findById(criminalId)).status, "arrested");
});

test("case retrieval and report list, retrieval, and deletion respect assignment and ownership", async () => {
    const fir = await FIR.create({
        ...firPayload({ firNo: "CORE-FIR-REPORT" }),
        registeredBy: officers.officerA._id,
        status: "Open",
    });
    const caseRecord = await Case.create({
        caseNo: "CORE-CASE-001",
        firId: fir._id,
        assignedOfficerIds: [officers.officerA._id],
        criminalIds: [criminal._id],
        title: "Market bicycle theft",
        description: "Investigation into market bicycle theft",
        startDate: "2026-09-02",
        status: "Open",
        priority: "Medium",
    });

    const assignedCase = await request(app).get(`/api/cases/${caseRecord._id}`).set(auth("officerA"));
    assert.equal(assignedCase.status, 200);
    assert.equal(assignedCase.body.data.caseNo, "CORE-CASE-001");
    const unassignedCase = await request(app).get(`/api/cases/${caseRecord._id}`).set(auth("officerB"));
    assert.equal(unassignedCase.status, 403);
    assert.equal(unassignedCase.body.error, "CASE_ACCESS_DENIED");
    const seniorCase = await request(app).get(`/api/cases/${caseRecord._id}`).set(auth("inspector"));
    assert.equal(seniorCase.status, 200);

    const created = await request(app).post("/api/reports").set(auth("officerA")).send({
        reportId: "CORE-RPT-001",
        caseId: String(caseRecord._id),
        reportType: "Investigation Report",
        title: "Initial findings",
        content: "CCTV footage requested from the market association.",
        reportDate: "2026-09-03",
        status: "Draft",
    });
    assert.equal(created.status, 201);
    assert.equal(String(created.body.data.preparedBy._id), String(officers.officerA._id));
    const reportId = created.body.data._id;

    const ownList = await request(app).get("/api/reports").set(auth("officerA"));
    assert.equal(ownList.status, 200);
    assert.deepEqual(ownList.body.data.map((report) => report.reportId), ["CORE-RPT-001"]);
    const otherList = await request(app).get("/api/reports").set(auth("officerB"));
    assert.equal(otherList.status, 200);
    assert.equal(otherList.body.count, 0);

    const ownGet = await request(app).get(`/api/reports/${reportId}`).set(auth("officerA"));
    assert.equal(ownGet.status, 200);
    assert.equal(ownGet.body.data.caseId.caseNo, "CORE-CASE-001");
    const otherGet = await request(app).get(`/api/reports/${reportId}`).set(auth("officerB"));
    assert.equal(otherGet.status, 403);
    assert.equal(otherGet.body.error, "REPORT_ACCESS_DENIED");

    const otherDelete = await request(app).delete(`/api/reports/${reportId}`).set(auth("officerB"));
    assert.equal(otherDelete.status, 403);
    assert.equal(otherDelete.body.error, "REPORT_ACCESS_DENIED");
    assert.ok(await Report.exists({ _id: reportId }), "a denied delete must not remove the report");

    const deleted = await request(app).delete(`/api/reports/${reportId}`).set(auth("officerA"));
    assert.equal(deleted.status, 200);
    assert.equal(String(deleted.body.data.id), String(reportId));
    assert.equal(await Report.exists({ _id: reportId }), null);

    const afterDelete = await request(app).get(`/api/reports/${reportId}`).set(auth("officerA"));
    assert.equal(afterDelete.status, 404);
    assert.equal(afterDelete.body.error, "REPORT_NOT_FOUND");
    const deleteAgain = await request(app).delete(`/api/reports/${reportId}`).set(auth("officerA"));
    assert.equal(deleteAgain.status, 404);
});

test("malformed IDs return 400 and nonexistent IDs return 404 across core record endpoints", async () => {
    const malformedId = "not-a-valid-id";
    const missingId = String(new mongoose.Types.ObjectId());

    for (const [resource, code] of [
        ["firs", "FIR"],
        ["criminals", "CRIMINAL"],
        ["cases", "CASE"],
        ["reports", "REPORT"],
    ]) {
        const malformed = await request(app).get(`/api/${resource}/${malformedId}`).set(auth("inspector"));
        assert.equal(malformed.status, 400, `${resource} malformed ID`);
        assert.equal(malformed.body.success, false);
        assert.equal(malformed.body.error, `INVALID_${code}_ID`);

        const missing = await request(app).get(`/api/${resource}/${missingId}`).set(auth("inspector"));
        assert.equal(missing.status, 404, `${resource} nonexistent ID`);
        assert.equal(missing.body.success, false);
        assert.equal(missing.body.error, `${code}_NOT_FOUND`);
    }

    const missingFIRUpdate = await request(app)
        .put(`/api/firs/${missingId}`)
        .set(auth("inspector"))
        .send({ description: "No such FIR" });
    assert.equal(missingFIRUpdate.status, 405);
    assert.equal(missingFIRUpdate.body.error, "FIR_IMMUTABLE");

    const missingFIRStatus = await request(app)
        .patch(`/api/firs/${missingId}/status`)
        .set(auth("inspector"))
        .send({ status: "Closed" });
    assert.equal(missingFIRStatus.status, 404);

    const malformedFIRStatus = await request(app)
        .patch(`/api/firs/${malformedId}/status`)
        .set(auth("inspector"))
        .send({ status: "Closed" });
    assert.equal(malformedFIRStatus.status, 400);
    assert.equal(malformedFIRStatus.body.error, "INVALID_FIR_ID");

    const missingCriminalStatus = await request(app)
        .patch(`/api/criminals/${missingId}/status`)
        .set(auth("inspector"))
        .send({ status: "arrested" });
    assert.equal(missingCriminalStatus.status, 404);
    assert.equal(missingCriminalStatus.body.error, "CRIMINAL_NOT_FOUND");
});

test("malformed JSON bodies are rejected with a consistent 400 response before any record is written", async () => {
    const firCountBefore = await FIR.countDocuments();

    const response = await request(app)
        .post("/api/firs")
        .set(auth("officerA"))
        .set("Content-Type", "application/json")
        .send('{"firNo": "CORE-FIR-JSON", ');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
        success: false,
        message: "Request body must be valid JSON",
        error: "INVALID_JSON",
    });
    assert.equal(await FIR.countDocuments(), firCountBefore);
});
