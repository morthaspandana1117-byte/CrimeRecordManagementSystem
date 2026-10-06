const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "officer-management-authorization-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const { classifyOfficerRank } = require("../scripts/migrateOfficerRanks");
const {
    normalizeOfficerRank,
    normalizeOfficerManagementRank,
} = require("../middleware/authority");

const rankHierarchy = ["sp", "dsp", "inspector", "si", "asi", "head_constable", "constable"];
let mongoServer;
let app;
let tokens;
let users;
let officers;
let passwordHash;

const createPendingOfficer = async (username, officerId, badgeNumber) => {
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash,
        role: "officer",
        status: "pending",
        isActive: true,
    });
    const officer = await Officer.create({
        userId: user._id,
        officerId,
        badgeNumber,
        name: username,
        rank: "constable",
        department: "Criminal Investigation",
        station: "Management Station",
        phoneNumber: "5551000000",
        address: "Test Street",
        joiningDate: "2020-01-01",
        status: "active",
    });
    return { user, officer };
};

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-officer-management"));
    app = createApp();
    passwordHash = await bcrypt.hash("Management@123", 10);
    users = {};
    officers = {};
    tokens = {};

    users.admin = await User.create({
        username: "management-admin",
        email: "management-admin@crms.test",
        passwordHash,
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    for (const [index, rank] of rankHierarchy.entries()) {
        users[rank] = await User.create({
            username: `management-${rank}`,
            email: `management-${rank}@crms.test`,
            passwordHash,
            role: "officer",
            status: "approved",
            isActive: true,
        });
        officers[rank] = await Officer.create({
            userId: users[rank]._id,
            officerId: `MGT-${rank}`,
            badgeNumber: `M${String(index).padStart(5, "0")}`,
            name: `Officer ${rank}`,
            rank,
            department: "Criminal Investigation",
            station: "Management Station",
            phoneNumber: "5551000000",
            address: "Test Street",
            joiningDate: "2020-01-01",
            status: "active",
        });
    }

    for (const key of ["admin", ...rankHierarchy]) {
        const login = await request(app)
            .post("/api/auth/login")
            .send({ username: users[key].username, password: "Management@123" });
        assert.equal(login.status, 200);
        tokens[key] = login.body.token;
    }
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("senior ranks can manage only strictly lower-ranked officers", async () => {
    for (let managerIndex = 0; managerIndex < rankHierarchy.length; managerIndex += 1) {
        const managerRank = rankHierarchy[managerIndex];
        const list = await request(app)
            .get("/api/officers/subordinates")
            .set("Authorization", `Bearer ${tokens[managerRank]}`);
        if (managerIndex >= 4) {
            assert.equal(list.status, 403, `${managerRank} must not access subordinate management`);
            continue;
        }
        assert.equal(list.status, 200, managerRank);
        assert.deepEqual(
            list.body.data.map((officer) => officer.rank),
            rankHierarchy.slice(managerIndex + 1),
            `${managerRank} should only list lower ranks`,
        );
        assert.ok(list.body.data.every((officer) =>
            officer.userId?.role === "officer" && officer.userId?.isActive === true),
        "populated officer accounts include explicit role and isActive fields");

        for (let targetIndex = 0; targetIndex < rankHierarchy.length; targetIndex += 1) {
            const targetRank = rankHierarchy[targetIndex];
            const response = await request(app)
                .put(`/api/officers/${officers[targetRank]._id}`)
                .set("Authorization", `Bearer ${tokens[managerRank]}`)
                .send({ name: `Edited by ${managerRank}` });
            assert.equal(response.status, managerIndex < 4 && targetIndex > managerIndex ? 200 : 403,
                `${managerRank} -> ${targetRank}`);
        }
    }

    for (const rank of ["asi", "head_constable", "constable"]) {
        const response = await request(app)
            .put(`/api/officers/${officers.constable._id}`)
            .set("Authorization", `Bearer ${tokens[rank]}`)
            .send({ name: "Unauthorized edit" });
        assert.equal(response.status, 403, `${rank} must not manage officers`);
    }
});

test("officer and administrative lists use separate authorization scopes", async () => {
    const dspAdminList = await request(app)
        .get("/api/officers")
        .set("Authorization", `Bearer ${tokens.dsp}`);
    assert.equal(dspAdminList.status, 403);

    const adminList = await request(app)
        .get("/api/officers")
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(adminList.status, 200);
    assert.ok(adminList.body.data.length > 0);
    assert.equal(adminList.body.data.some((record) => "rank" in record || "department" in record), false);
});

test("authentication returns a separate server-resolved management rank", async () => {
    const login = await request(app)
        .post("/api/auth/login")
        .send({ username: users.si.username, password: "Management@123" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.rank, "investigating_officer");
    assert.equal(login.body.user.managementRank, "si");

    const currentUser = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.data.rank, "investigating_officer");
    assert.equal(currentUser.body.data.managementRank, "si");
});

test("system admin handles approval and account status, not police profile edits or operations", async () => {
    const approvedRegistration = await createPendingOfficer("management-pending-approve", "MGT-PENDING-A", "MPA001");
    const rejectedRegistration = await createPendingOfficer("management-pending-reject", "MGT-PENDING-R", "MPR001");

    const approve = await request(app)
        .patch(`/api/officers/${approvedRegistration.officer._id}/approve`)
        .set("Authorization", `Bearer ${tokens.admin}`);
    const reject = await request(app)
        .patch(`/api/officers/${rejectedRegistration.officer._id}/reject`)
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(approve.status, 200);
    assert.equal(reject.status, 200);
    assert.equal((await User.findById(approvedRegistration.user._id)).status, "approved");
    assert.equal((await User.findById(rejectedRegistration.user._id)).status, "rejected");

    const adminProfileEdit = await request(app)
        .put(`/api/officers/${officers.constable._id}`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ name: "Admin cannot profile edit" });
    assert.equal(adminProfileEdit.status, 403);
    const rankBeforeAdminAttempt = (await Officer.findById(officers.constable._id)).rank;
    const adminRankEdit = await request(app)
        .put(`/api/officers/${officers.constable._id}`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ rank: "sp" });
    assert.equal(adminRankEdit.status, 403);
    assert.equal((await Officer.findById(officers.constable._id)).rank, rankBeforeAdminAttempt);

    const adminOfficerDetails = await request(app)
        .get(`/api/officers/${officers.constable._id}`)
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(adminOfficerDetails.status, 200);
    assert.deepEqual(Object.keys(adminOfficerDetails.body.data).sort(), [
        "_id", "accountStatus", "approvalStatus", "email", "username",
    ]);

    const adminAssignable = await request(app)
        .get("/api/officers/assignable")
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(adminAssignable.status, 200);
    assert.deepEqual(adminAssignable.body.data, []);
    const officerAssignable = await request(app)
        .get("/api/officers/assignable")
        .set("Authorization", `Bearer ${tokens.sp}`);
    assert.equal(officerAssignable.status, 200);
    assert.equal(officerAssignable.body.data.length, rankHierarchy.length + 1);

    const deactivate = await request(app)
        .patch(`/api/officers/${officers.constable._id}/status`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ accountStatus: "inactive" });
    assert.equal(deactivate.status, 200);
    const blockedLogin = await request(app)
        .post("/api/auth/login")
        .send({ username: users.constable.username, password: "Management@123" });
    assert.equal(blockedLogin.status, 403);

    const activate = await request(app)
        .patch(`/api/officers/${officers.constable._id}/status`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ accountStatus: "active" });
    assert.equal(activate.status, 200);
    const restoredLogin = await request(app)
        .post("/api/auth/login")
        .send({ username: users.constable.username, password: "Management@123" });
    assert.equal(restoredLogin.status, 200);

    const adminCreateFIR = await request(app)
        .post("/api/firs")
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({});
    const adminCreateCase = await request(app)
        .post("/api/cases")
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({});
    const adminVerifyEvidence = await request(app)
        .patch(`/api/evidence/${new mongoose.Types.ObjectId()}/verify`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ verificationStatus: "verified" });
    assert.equal(adminCreateFIR.status, 403);
    assert.equal(adminCreateCase.status, 403);
    assert.equal(adminVerifyEvidence.status, 403);
});

test("senior profile updates cannot change rank, credentials, account status, or role", async () => {
    const target = officers.si;
    const before = await Officer.findById(target._id).lean();
    const userBefore = await User.findById(users.si._id).lean();
    const attemptedEscalation = await request(app)
        .put(`/api/officers/${target._id}`)
        .set("Authorization", `Bearer ${tokens.inspector}`)
        .send({
            name: "Should not change",
            rank: "sp",
            password: "Changed@123",
            passwordHash: "forged-hash",
            passwordResetToken: "forged-token",
            passwordResetExpires: new Date().toISOString(),
            systemRole: "system_admin",
            status: "inactive",
        });
    assert.equal(attemptedEscalation.status, 403);
    assert.equal((await Officer.findById(target._id)).rank, before.rank);
    assert.equal((await Officer.findById(target._id)).name, before.name);
    const userAfter = await User.findById(users.si._id).lean();
    assert.equal(userAfter.passwordHash, userBefore.passwordHash);
    assert.equal(userAfter.passwordResetToken, userBefore.passwordResetToken);
    assert.equal(userAfter.role, userBefore.role);

    const clientRankSpoof = await request(app)
        .put(`/api/officers/${officers.sp._id}`)
        .set("Authorization", `Bearer ${tokens.si}`)
        .send({ rank: "constable", officerRank: "constable", systemRole: "system_admin" });
    assert.equal(clientRankSpoof.status, 403);
    assert.equal((await Officer.findById(officers.sp._id)).rank, "sp");
});

test("account status changes follow subordinate rank and update only status fields", async () => {
    // This existing-style legacy value is outside the canonical schema enum.
    // Status updates must still succeed without validating or rewriting rank.
    await Officer.collection.updateOne(
        { _id: officers.si._id },
        { $set: { rank: "SI" } },
    );

    const protectedProfileFields = [
        "rank", "officerId", "badgeNumber", "name", "department", "station",
        "phoneNumber", "address", "joiningDate",
    ];

    for (const rank of rankHierarchy) {
        const before = await Officer.findById(officers[rank]._id).lean();
        const beforeUser = await User.findById(users[rank]._id).lean();
        const deactivate = await request(app)
            .patch(`/api/officers/${officers[rank]._id}/status`)
            .set("Authorization", `Bearer ${tokens.admin}`)
            .send({
                accountStatus: "inactive",
                rank: "constable",
                officerId: "FORGED-ID",
                badgeNumber: "FORGED",
                name: "Forged name",
                department: "Traffic",
                station: "Forged station",
                phoneNumber: "5559999999",
                address: "Forged address",
                joiningDate: "2030-01-01",
                role: "system_admin",
                systemRole: "system_admin",
                password: "Forged@123",
                passwordHash: "forged-hash",
                passwordResetToken: "forged-token",
                passwordResetExpires: "2030-01-01",
                audit: { actor: "forged" },
            });
        assert.equal(deactivate.status, 200, rank);
        const inactiveOfficer = await Officer.findById(officers[rank]._id).lean();
        const inactiveUser = await User.findById(users[rank]._id).lean();
        assert.equal(inactiveOfficer.status, "inactive");
        assert.equal(inactiveUser.isActive, false);
        assert.equal(inactiveUser.passwordHash, beforeUser.passwordHash);
        for (const field of protectedProfileFields) {
            assert.deepEqual(inactiveOfficer[field], before[field], `${rank}.${field} must remain unchanged`);
        }

        const activate = await request(app)
            .patch(`/api/officers/${officers[rank]._id}/status`)
            .set("Authorization", `Bearer ${tokens.admin}`)
            .send({ accountStatus: "active" });
        assert.equal(activate.status, 200, rank);
        assert.equal((await User.findById(users[rank]._id)).isActive, true);
        assert.equal((await Officer.findById(officers[rank]._id)).rank, before.rank);
    }

    for (const managerRank of ["sp", "dsp", "inspector", "si"]) {
        const managerIndex = rankHierarchy.indexOf(managerRank);
        for (let targetIndex = managerIndex + 1; targetIndex < rankHierarchy.length; targetIndex += 1) {
            const targetRank = rankHierarchy[targetIndex];
            const originalRank = (await Officer.findById(officers[targetRank]._id)).rank;
            const deactivate = await request(app)
                .patch(`/api/officers/${officers[targetRank]._id}/status`)
                .set("Authorization", `Bearer ${tokens[managerRank]}`)
                .send({ accountStatus: "inactive", rank: "sp" });
            assert.equal(deactivate.status, 200, `${managerRank} -> ${targetRank} deactivate`);
            assert.equal((await User.findById(users[targetRank]._id)).isActive, false);
            assert.equal((await Officer.findById(officers[targetRank]._id)).rank, originalRank);

            const activate = await request(app)
                .patch(`/api/officers/${officers[targetRank]._id}/status`)
                .set("Authorization", `Bearer ${tokens[managerRank]}`)
                .send({ accountStatus: "active", rank: "constable" });
            assert.equal(activate.status, 200, `${managerRank} -> ${targetRank} activate`);
            assert.equal((await User.findById(users[targetRank]._id)).isActive, true);
            assert.equal((await Officer.findById(officers[targetRank]._id)).rank, originalRank);
        }

        for (let targetIndex = 0; targetIndex <= managerIndex; targetIndex += 1) {
            const targetRank = rankHierarchy[targetIndex];
            const before = await Officer.findById(officers[targetRank]._id).lean();
            const denied = await request(app)
                .patch(`/api/officers/${officers[targetRank]._id}/status`)
                .set("Authorization", `Bearer ${tokens[managerRank]}`)
                .send({ accountStatus: "inactive", rank: "constable" });
            assert.equal(denied.status, 403, `${managerRank} cannot change ${targetRank}`);
            assert.equal((await Officer.findById(officers[targetRank]._id)).status, before.status);
        }
    }

    for (const managerRank of ["asi", "head_constable", "constable"]) {
        const denied = await request(app)
            .patch(`/api/officers/${officers.constable._id}/status`)
            .set("Authorization", `Bearer ${tokens[managerRank]}`)
            .send({ accountStatus: "inactive" });
        assert.equal(denied.status, 403, managerRank);
    }

    const deactivateSI = await request(app)
        .patch(`/api/officers/${officers.si._id}/status`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ accountStatus: "inactive" });
    assert.equal(deactivateSI.status, 200);
    const blockedLogin = await request(app)
        .post("/api/auth/login")
        .send({ username: users.si.username, password: "Management@123" });
    assert.equal(blockedLogin.status, 403);
    const activateSI = await request(app)
        .patch(`/api/officers/${officers.si._id}/status`)
        .set("Authorization", `Bearer ${tokens.admin}`)
        .send({ accountStatus: "active" });
    assert.equal(activateSI.status, 200);
    const restoredLogin = await request(app)
        .post("/api/auth/login")
        .send({ username: users.si.username, password: "Management@123" });
    assert.equal(restoredLogin.status, 200);
    assert.equal((await Officer.findById(officers.si._id)).rank, "SI");
});

test("ambiguous investigating_officer rank remains unresolved during migration classification", () => {
    assert.equal(normalizeOfficerRank("investigating_officer"), "investigating_officer");
    assert.equal(normalizeOfficerManagementRank("investigating_officer"), null);
    assert.deepEqual(classifyOfficerRank("investigating_officer"), {
        status: "unresolved",
        canonicalRank: null,
    });
    assert.deepEqual(classifyOfficerRank("SI"), {
        status: "migratable",
        canonicalRank: "si",
    });
    assert.deepEqual(classifyOfficerRank("Head Constable"), {
        status: "migratable",
        canonicalRank: "head_constable",
    });
});
