const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "dashboard-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const Report = require("../models/Report");

let mongoServer;
let app;
let tokens;
let officers;
let users;

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("crms-dashboard"));
    app = createApp();

    const passwordHash = await bcrypt.hash("Dashboard@123", 10);
    users = {};
    officers = {};
    for (const [key, role, rank] of [
        ["admin", "system_admin", null],
        ["officerA", "officer", "investigating_officer"],
        ["officerB", "officer", "investigating_officer"],
        ["inspector", "officer", "inspector"],
    ]) {
        users[key] = await User.create({
            username: `dashboard-${key}`,
            email: `dashboard-${key}@crms.test`,
            passwordHash,
            role,
            status: "approved",
            isActive: true,
        });
        if (rank) {
            officers[key] = await Officer.create({
                userId: users[key]._id,
                officerId: `DASH-${key}`,
                badgeNumber: `${key === "officerA" ? "DA" : key === "officerB" ? "DB" : "DI"}0001`,
                name: key,
                rank,
                department: "Criminal Investigation",
                station: "Dashboard Station",
                phoneNumber: "5550000000",
                address: "Test Street",
                joiningDate: "2020-01-01",
                status: "active",
            });
        }
    }

    tokens = {};
    for (const key of Object.keys(users)) {
        const login = await request(app)
            .post("/api/auth/login")
            .send({ username: users[key].username, password: "Dashboard@123" });
        assert.equal(login.status, 200);
        tokens[key] = login.body.token;
    }
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("dashboard counts follow FIR, case, evidence, and report visibility rules", async () => {
    const firA = await FIR.create({
        firNo: "DASH-FIR-A",
        date: "2026-01-01",
        policeStation: "Dashboard Station",
        complaint: { complainantName: "A", complaintText: "A complaint" },
        description: "A FIR",
        crimeType: "Theft",
        location: { address: "A", city: "A", state: "A", pincode: "000001" },
        registeredBy: officers.officerA._id,
    });
    const firB = await FIR.create({
        firNo: "DASH-FIR-B",
        date: "2026-01-02",
        policeStation: "Dashboard Station",
        complaint: { complainantName: "B", complaintText: "B complaint" },
        description: "B FIR",
        crimeType: "Theft",
        location: { address: "B", city: "B", state: "B", pincode: "000002" },
        registeredBy: officers.officerB._id,
    });

    const caseA = await Case.create({
        caseNo: "DASH-CASE-A", firId: firA._id,
        assignedOfficerIds: [officers.officerA._id], criminalIds: [],
        title: "A", description: "A case", startDate: "2026-01-01",
        status: "Open", priority: "Low",
    });
    const caseB = await Case.create({
        caseNo: "DASH-CASE-B", firId: firB._id,
        assignedOfficerIds: [officers.officerB._id], criminalIds: [],
        title: "B", description: "B case", startDate: "2026-01-02",
        status: "Open", priority: "Low",
    });
    for (const [suffix, caseRecord, officer] of [
        ["A", caseA, officers.officerA], ["B", caseB, officers.officerB],
    ]) {
        await Evidence.create({
            evidenceId: `DASH-EVIDENCE-${suffix}`,
            caseId: caseRecord._id,
            investigationRound: 1,
            type: "Document",
            description: `${suffix} evidence`,
            collectedBy: officer._id,
            collectionDate: "2026-01-03",
            location: "Evidence room",
        });
        await Report.create({
            reportId: `DASH-REPORT-${suffix}`,
            caseId: caseRecord._id,
            preparedBy: officer._id,
            reportType: "Progress Report",
            title: `${suffix} report`,
            content: `${suffix} report content`,
            reportDate: "2026-01-04",
        });
    }

    const unauthenticated = await request(app).get("/api/dashboard/stats");
    assert.equal(unauthenticated.status, 401);

    const officerResponse = await request(app)
        .get("/api/dashboard/stats")
        .set("Authorization", `Bearer ${tokens.officerA}`)
        .query({ officerId: officers.officerB._id.toString(), userId: users.officerB._id.toString(), systemRole: "system_admin" });
    assert.equal(officerResponse.status, 200);
    assert.deepEqual(officerResponse.body.data, {
        totalFIRs: 1, totalCases: 1, totalEvidence: 1, totalReports: 1,
    });

    const inspectorResponse = await request(app)
        .get("/api/dashboard/stats")
        .set("Authorization", `Bearer ${tokens.inspector}`);
    assert.equal(inspectorResponse.status, 200);
    assert.deepEqual(inspectorResponse.body.data, {
        totalFIRs: 2, totalCases: 2, totalEvidence: 2, totalReports: 0,
    });

    const adminResponse = await request(app)
        .get("/api/dashboard/admin/stats")
        .set("Authorization", `Bearer ${tokens.admin}`);
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.body.data.totalFIRs, 2);
    assert.equal(adminResponse.body.data.totalCases, 2);
    assert.equal(adminResponse.body.data.totalEvidence, 2);
    assert.equal(adminResponse.body.data.totalReports, 2);
    assert.equal(JSON.stringify(adminResponse.body).includes("passwordHash"), false);
    assert.equal(JSON.stringify(adminResponse.body).includes(tokens.admin), false);

    const officerCannotAccessAdminDashboard = await request(app)
        .get("/api/dashboard/admin/stats")
        .set("Authorization", `Bearer ${tokens.officerA}`);
    assert.equal(officerCannotAccessAdminDashboard.status, 403);
});
