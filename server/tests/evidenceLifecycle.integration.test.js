const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");

let mongoServer;
let app;
let adminToken;
let officerToken;
let investigatingToken;
let officer;
let criminal;

const password = "Integration@123";

const login = async (username) => {
    const response = await request(app)
        .post("/api/auth/login")
        .send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createEvidence = async (token, evidenceId, collectionDate) => {
    const response = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${token}`)
        .send({
            evidenceId,
            caseId: global.caseId,
            type: "Physical",
            description: `${evidenceId} collected during investigation`,
            collectedBy: officer._id.toString(),
            collectionDate,
            location: "Main Street Market",
            status: "Collected",
        });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.evidenceId, evidenceId);
    return response.body.data;
};

const evidenceSnapshot = async () =>
    Evidence.find({ caseId: global.caseId }).sort({ evidenceId: 1 }).lean();

 test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri("crms-evidence-lifecycle");
    if (!mongoUri.startsWith("mongodb://127.0.0.1") && !mongoUri.startsWith("mongodb://localhost")) {
        throw new Error("Integration test did not receive an isolated MongoDB URI");
    }

    process.env.MONGO_URI = mongoUri;
    await mongoose.connect(mongoUri);
    app = createApp();

    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await User.create({
        username: "integration-admin",
        email: "integration-admin@crms.test",
        passwordHash,
        role: "admin",
        status: "approved",
        isActive: true,
    });
    const officerUser = await User.create({
        username: "integration-officer",
        email: "integration-officer@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    const investigatingUser = await User.create({
        username: "integration-investigating",
        email: "integration-investigating@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });

    officer = await Officer.create({
        userId: officerUser._id,
        officerId: "INT-OFFICER-001",
        badgeNumber: "INT001",
        name: "Integration Officer",
        rank: "inspector",
        department: "Criminal Investigation",
        station: "Central Station",
        phoneNumber: "5550101000",
        address: "1 Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
    await Officer.create({
        userId: investigatingUser._id,
        officerId: "INT-OFFICER-002",
        badgeNumber: "INT002",
        name: "Integration Investigating Officer",
        rank: "investigating_officer",
        department: "Criminal Investigation",
        station: "Central Station",
        phoneNumber: "5550101003",
        address: "3 Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
    criminal = await Criminal.create({
        criminalId: "INT-CRIM-001",
        fullName: "Integration Criminal",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "2 Test Avenue",
        phoneNumber: "5550101001",
        status: "active",
    });

    adminToken = await login(admin.username);
    officerToken = await login(officerUser.username);
    investigatingToken = await login(investigatingUser.username);
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("persists the complete evidence lifecycle across case reopening", async () => {
    const firResponse = await request(app)
        .post("/api/firs")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
            firNo: "INT-FIR-001",
            date: "2026-09-01",
            policeStation: "Central Station",
            complaint: {
                complainantName: "Integration Complainant",
                complainantPhone: "5550101002",
                complaintText: "Integration lifecycle complaint",
            },
            description: "Integration lifecycle FIR",
            crimeType: "Theft",
            location: {
                address: "Main Street Market",
                city: "Test City",
                state: "Test State",
                pincode: "123456",
            },
            criminalIds: [criminal._id.toString()],
            status: "Registered",
        });
    assert.equal(firResponse.status, 201);
    const firId = firResponse.body.data._id;
    assert.ok(await FIR.exists({ _id: firId, firNo: "INT-FIR-001" }));
    assert.equal((await request(app).get(`/api/firs/${firId}`).set("Authorization", `Bearer ${officerToken}`)).status, 200);

    const caseResponse = await request(app)
        .post("/api/cases")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
            caseNo: "INT-CASE-001",
            firId,
            assignedOfficerIds: [officer._id.toString()],
            criminalIds: [criminal._id.toString()],
            title: "Integration lifecycle case",
            description: "Case for evidence preservation integration testing",
            startDate: "2026-09-02",
            status: "Open",
            priority: "High",
        });
    assert.equal(caseResponse.status, 201);
    global.caseId = caseResponse.body.data._id;
    const createdCase = await Case.findById(global.caseId).lean();
    assert.equal(createdCase.firId.toString(), firId.toString());
    assert.equal(createdCase.status, "Open");
    assert.equal(createdCase.currentInvestigationRound, 1);
    assert.equal(createdCase.investigationHistory.length, 1);

    await createEvidence(officerToken, "E-001", "2026-09-03");
    await createEvidence(officerToken, "E-002", "2026-09-04");
    await createEvidence(officerToken, "E-003", "2026-09-05");
    assert.deepEqual((await evidenceSnapshot()).map((item) => item.evidenceId), ["E-001", "E-002", "E-003"]);
    assert.equal((await evidenceSnapshot()).every((item) => item.investigationRound === 1), true);

    const closeOne = await request(app)
        .patch(`/api/cases/${global.caseId}/status`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ status: "Closed", closureReason: "Initial investigation complete" });
    assert.equal(closeOne.status, 200);
    assert.equal((await Case.findById(global.caseId)).status, "Closed");
    assert.equal((await evidenceSnapshot()).length, 3);

    const blockedEvidence = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
            evidenceId: "E-CLOSED",
            caseId: global.caseId,
            type: "Document",
            description: "Must be rejected",
            collectedBy: officer._id.toString(),
            collectionDate: "2026-09-06",
            location: "Main Street Market",
            status: "Collected",
        });
    assert.equal(blockedEvidence.status, 409);
    assert.equal(await Evidence.exists({ evidenceId: "E-CLOSED" }), null);

    const unauthorizedReopen = await request(app)
        .patch(`/api/cases/${global.caseId}/reopen`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reopenReason: "Additional investigation required" });
    assert.equal(unauthorizedReopen.status, 403);

    const reopen = await request(app)
        .patch(`/api/cases/${global.caseId}/reopen`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ reopenReason: "Additional investigation required based on newly discovered information." });
    assert.equal(reopen.status, 200);
    const reopenedCase = await Case.findById(global.caseId).lean();
    assert.equal(reopenedCase.status, "Reopened");
    assert.equal(reopenedCase.currentInvestigationRound, 2);
    assert.equal(reopenedCase.investigationHistory.length, 2);
    assert.equal(reopenedCase.investigationHistory[0].closureReason, "Initial investigation complete");
    assert.equal(reopenedCase.investigationHistory[0].reopenReason, "Additional investigation required based on newly discovered information.");
    assert.ok(reopenedCase.investigationHistory[0].reopenedAt);
    assert.ok(reopenedCase.investigationHistory[0].reopenedBy);
    assert.equal(reopenedCase._id.toString(), global.caseId.toString());

    await createEvidence(officerToken, "E-004", "2026-09-25");
    await createEvidence(officerToken, "E-005", "2026-09-26");
    const roundOne = await request(app)
        .get(`/api/evidence?caseId=${global.caseId}&investigationRound=1`)
        .set("Authorization", `Bearer ${officerToken}`);
    const roundTwo = await request(app)
        .get(`/api/evidence?caseId=${global.caseId}&investigationRound=2`)
        .set("Authorization", `Bearer ${officerToken}`);
    assert.deepEqual(roundOne.body.data.map((item) => item.evidenceId).sort(), ["E-001", "E-002", "E-003"]);
    assert.deepEqual(roundTwo.body.data.map((item) => item.evidenceId).sort(), ["E-004", "E-005"]);

    const originalE1 = await Evidence.findOne({ evidenceId: "E-001" }).lean();
    const protectedUpdate = await request(app)
        .put(`/api/evidence/${originalE1._id}`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({
            caseId: new mongoose.Types.ObjectId().toString(),
            collectedBy: new mongoose.Types.ObjectId().toString(),
            collectionDate: "2030-01-01",
            investigationRound: 99,
            description: "Administrative description correction",
        });
    assert.equal(protectedUpdate.status, 200);
    const unchangedE1 = await Evidence.findById(originalE1._id).lean();
    assert.equal(unchangedE1.caseId.toString(), originalE1.caseId.toString());
    assert.equal(unchangedE1.collectedBy.toString(), originalE1.collectedBy.toString());
    assert.equal(unchangedE1.collectionDate.toISOString(), originalE1.collectionDate.toISOString());
    assert.equal(unchangedE1.investigationRound, originalE1.investigationRound);

    const deleteAttempt = await request(app)
        .delete(`/api/evidence/${originalE1._id}`)
        .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(deleteAttempt.status >= 400, true);
    assert.ok(await Evidence.exists({ _id: originalE1._id }));

    const closeTwo = await request(app)
        .patch(`/api/cases/${global.caseId}/status`)
        .set("Authorization", `Bearer ${officerToken}`)
        .send({ status: "Closed", closureReason: "Additional investigation complete" });
    assert.equal(closeTwo.status, 200);

    const finalCase = await Case.findById(global.caseId).lean();
    const finalEvidence = await evidenceSnapshot();
    assert.equal(finalCase.status, "Closed");
    assert.equal(finalCase.investigationHistory.length, 2);
    assert.ok(finalCase.investigationHistory.every((round) => round.closedAt));
    assert.equal(finalEvidence.length, 5);
    assert.deepEqual(finalEvidence.filter((item) => item.investigationRound === 1).map((item) => item.evidenceId).sort(), ["E-001", "E-002", "E-003"]);
    assert.deepEqual(finalEvidence.filter((item) => item.investigationRound === 2).map((item) => item.evidenceId).sort(), ["E-004", "E-005"]);
    assert.equal(finalEvidence.every((item) => item.caseId.toString() === global.caseId.toString()), true);
    assert.equal(finalEvidence.every((item) => item.collectedBy.toString() === officer._id.toString()), true);
    assert.deepEqual(
        Object.fromEntries(finalEvidence.map((item) => [item.evidenceId, item.collectionDate.toISOString().slice(0, 10)])),
        {
            "E-001": "2026-09-03",
            "E-002": "2026-09-04",
            "E-003": "2026-09-05",
            "E-004": "2026-09-25",
            "E-005": "2026-09-26",
        },
    );
});
