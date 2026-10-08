const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.JWT_SECRET = "crime-statistics-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const FIR = require("../models/FIR");
const Case = require("../models/Case");

let mongoServer;
let app;
let officerA;
let officerB;
let inspector;
let officerAToken;
let inspectorToken;
let adminToken;
const password = "CrimeStats@123";

const createAccount = async ({ username, rank }) => {
    const user = await User.create({
        username,
        email: `${username}@crms.test`,
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: true,
    });
    return Officer.create({
        userId: user._id,
        officerId: `CS-${username}`,
        badgeNumber: `STA00${username.slice(-1).toUpperCase()}`,
        name: username,
        rank,
        department: "Criminal Investigation",
        station: "Statistics Station",
        phoneNumber: "5550201000",
        address: "Statistics Test Avenue",
        joiningDate: "2020-01-01",
        status: "active",
    });
};

const login = async (username) => {
    const response = await request(app).post("/api/auth/login").send({ username, password });
    assert.equal(response.status, 200);
    return response.body.token;
};

const createFIR = (registeredBy, data) => FIR.create({
    firNo: data.firNo,
    date: data.date,
    policeStation: "Statistics Station",
    complaint: { complainantName: "Test Complainant", complaintText: "Test complaint" },
    description: "Statistics fixture",
    crimeType: data.crimeType,
    location: { address: "1 Test Road", city: data.city, state: data.state || "Karnataka", pincode: data.pincode || "560001" },
    registeredBy,
    criminalIds: [],
    status: data.status,
});

test.before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri("crms-crime-statistics");
    if (!mongoUri.startsWith("mongodb://127.0.0.1") && !mongoUri.startsWith("mongodb://localhost")) {
        throw new Error("Crime statistics test did not receive an isolated MongoDB URI");
    }
    await mongoose.connect(mongoUri);
    app = createApp();
    officerA = await createAccount({ username: "stats-officer-a", rank: "investigating_officer" });
    officerB = await createAccount({ username: "stats-officer-b", rank: "investigating_officer" });
    inspector = await createAccount({ username: "stats-inspector", rank: "inspector" });
    officerAToken = await login("stats-officer-a");
    inspectorToken = await login("stats-inspector");

    const admin = await User.create({
        username: "stats-system-admin",
        email: "stats-system-admin@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    adminToken = await login(admin.username);

    await createFIR(officerA._id, { firNo: "STATS-001", date: "2026-01-02", crimeType: "Theft", status: "Open", city: "Bengaluru" });
    await createFIR(officerA._id, { firNo: "STATS-002", date: "2026-01-02", crimeType: "Theft", status: "Under Investigation", city: "Mysuru" });
    await createFIR(officerA._id, { firNo: "STATS-003", date: "2026-02-10T23:59:59.999Z", crimeType: "Fraud", status: "Closed", city: "Bengaluru", pincode: "560002" });
    await createFIR(officerB._id, { firNo: "STATS-004", date: "2026-01-03", crimeType: "Murder", status: "Open", city: "Bengaluru" });
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

test("crime statistics uses server aggregation and the authenticated FIR scope", async () => {
    const response = await request(app)
        .get("/api/reports/crime-statistics?registeredBy=ignored&officerId=ignored")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "INVALID_FILTER");

    const scoped = await request(app)
        .get("/api/reports/crime-statistics?userId=ignored")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(scoped.status, 400);

    const aggregated = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(aggregated.status, 200);
    assert.equal(aggregated.body.data.totalFirs, 3);
    assert.deepEqual(aggregated.body.data.crimeTypeStats, [
        { crimeType: "Fraud", count: 1 },
        { crimeType: "Theft", count: 2 },
    ]);
    assert.deepEqual(aggregated.body.data.statusStats, [
        { status: "Closed", count: 1 },
        { status: "Open", count: 1 },
        { status: "Under Investigation", count: 1 },
    ]);
    assert.equal(aggregated.body.data.dateStats.length, 2);

    const broadOperational = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${inspectorToken}`);
    assert.equal(broadOperational.status, 200);
    assert.equal(broadOperational.body.data.totalFirs, 4);
});

test("crime statistics rejects unauthorized, invalid, and unsupported access safely", async () => {
    assert.equal((await request(app).get("/api/reports/crime-statistics")).status, 401);
    const admin = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(admin.status, 403);

    for (const query of [
        "fromDate=2026-02-30",
        "toDate=2026-02-31",
        "fromDate=2026-1-02",
        "toDate=2026-02-10T12%3A30%3A00Z",
        "fromDate=2026-02-10T12%3A30%3A00.000Z",
        "fromDate=2026-02-10&toDate=2026-01-01",
        "crimeType=NotARealCrime",
        "status=Unknown",
        "city[$ne]=Bengaluru",
    ]) {
        const response = await request(app)
            .get(`/api/reports/crime-statistics?${query}`)
            .set("Authorization", `Bearer ${officerAToken}`);
        assert.equal(response.status, 400, query);
    }
});

test("crime statistics supports date, crime type, status, and location filters including empty results", async () => {
    const get = (query) => request(app)
        .get(`/api/reports/crime-statistics?${query}`)
        .set("Authorization", `Bearer ${officerAToken}`);

    const dateRange = await get("fromDate=2026-01-02&toDate=2026-01-02");
    assert.equal(dateRange.status, 200);
    assert.equal(dateRange.body.data.totalFirs, 2);

    const crimeType = await get("crimeType=Fraud");
    assert.equal(crimeType.body.data.totalFirs, 1);
    assert.equal(crimeType.body.data.crimeTypeStats[0].crimeType, "Fraud");

    const status = await get("status=Closed");
    assert.equal(status.body.data.totalFirs, 1);

    const location = await get("city=Bengaluru&pincode=560002");
    assert.equal(location.body.data.totalFirs, 1);
    assert.equal(location.body.data.locationStats[0].city, "Bengaluru");

    const empty = await get("city=NoSuchCity");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data.totalFirs, 0);
    assert.deepEqual(empty.body.data.crimeTypeStats, []);
});

test("date-only filters include complete boundary days and exclude records outside the range", async () => {
    await createFIR(officerA._id, {
        firNo: "STATS-OUTSIDE-DATE-RANGE",
        date: "2026-02-11T00:00:00.000Z",
        crimeType: "Assault",
        status: "Open",
        city: "Bengaluru",
    });
    const get = (query) => request(app)
        .get(`/api/reports/crime-statistics?${query}`)
        .set("Authorization", `Bearer ${officerAToken}`);

    const fromOnly = await get("fromDate=2026-02-10");
    assert.equal(fromOnly.status, 200);
    assert.equal(fromOnly.body.data.totalFirs, 2);

    const toOnly = await get("toDate=2026-01-02");
    assert.equal(toOnly.status, 200);
    assert.equal(toOnly.body.data.totalFirs, 2);

    const fullRange = await get("fromDate=2026-01-02&toDate=2026-02-10");
    assert.equal(fullRange.status, 200);
    assert.equal(fullRange.body.data.totalFirs, 3);
    assert.deepEqual(fullRange.body.data.dateStats, [
        { date: "2026-01-02", count: 2 },
        { date: "2026-02-10", count: 1 },
    ]);
});

test("investigating officers cannot create reports for cases outside their assignment scope", async () => {
    const foreignCase = await Case.create({
        caseNo: "STATS-FOREIGN-CASE",
        firId: new mongoose.Types.ObjectId(),
        assignedOfficerIds: [officerB._id],
        criminalIds: [],
        title: "Foreign case",
        description: "Case assigned to another officer",
        startDate: "2026-01-01",
        status: "Open",
        priority: "Medium",
    });
    const response = await request(app)
        .post("/api/reports")
        .set("Authorization", `Bearer ${officerAToken}`)
        .send({
            reportId: "STATS-REPORT-001",
            caseId: foreignCase._id.toString(),
            reportType: "Progress Report",
            title: "Unauthorized case report",
            content: "Must be rejected",
            reportDate: "2026-01-10",
            status: "Draft",
        });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "REPORT_CASE_ACCESS_DENIED");
});
