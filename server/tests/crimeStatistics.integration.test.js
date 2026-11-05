const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

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

const createCase = (fir, data) => Case.create({
    caseNo: data.caseNo,
    firId: fir._id,
    assignedOfficerIds: [data.officerId],
    criminalIds: [],
    title: "Crime statistics fixture",
    description: "Synthetic case statistics fixture",
    startDate: data.startDate,
    status: data.status,
    priority: "Medium",
});

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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

    const firOne = await createFIR(officerA._id, { firNo: "STATS-001", date: "2026-01-02", crimeType: "Theft", status: "Open", city: "Bengaluru" });
    const firTwo = await createFIR(officerA._id, { firNo: "STATS-002", date: "2026-01-02", crimeType: "Theft", status: "Under Investigation", city: "Mysuru" });
    const firThree = await createFIR(officerA._id, { firNo: "STATS-003", date: "2026-02-10T23:59:59.999Z", crimeType: "Fraud", status: "Closed", city: "Bengaluru", pincode: "560002" });
    const firFour = await createFIR(officerB._id, { firNo: "STATS-004", date: "2026-01-03", crimeType: "Murder", status: "Open", city: "Bengaluru" });
    await createCase(firOne, { caseNo: "CS-STATS-001", startDate: "2026-01-02", status: "Open", officerId: officerA._id });
    await createCase(firTwo, { caseNo: "CS-STATS-002", startDate: "2026-01-02", status: "Under Investigation", officerId: officerA._id });
    await createCase(firThree, { caseNo: "CS-STATS-003", startDate: "2026-02-10T23:59:59.999Z", status: "Closed", officerId: officerA._id });
    await createCase(firFour, { caseNo: "CS-STATS-004", startDate: "2026-01-03", status: "Reopened", officerId: officerB._id });
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
    assert.equal(aggregated.body.data.caseStatistics.totalCases, 3);
    assert.equal(aggregated.body.data.caseStatistics.openCases, 2);
    assert.equal(aggregated.body.data.caseStatistics.closedCases, 1);
    assert.deepEqual(aggregated.body.data.caseStatistics.monthlyStats, [
        { month: "2026-01", count: 2 },
        { month: "2026-02", count: 1 },
    ]);
    assert.deepEqual(aggregated.body.data.caseStatistics.yearlyStats, [{ year: "2026", count: 3 }]);
    assert.equal(aggregated.body.data.caseStatistics.dateBasis, "Case.startDate (UTC)");

    const broadOperational = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${inspectorToken}`);
    assert.equal(broadOperational.status, 200);
    assert.equal(broadOperational.body.data.totalFirs, 4);
    assert.equal(broadOperational.body.data.caseStatistics.totalCases, 4);
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
        "caseStatus=Pending",
        "city[$ne]=Bengaluru",
        "policeStation[$ne]=Statistics Station",
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
    assert.equal(empty.body.data.caseStatistics.totalCases, 0);
    assert.equal(empty.body.data.caseStatistics.openCases, 0);
    assert.equal(empty.body.data.caseStatistics.closedCases, 0);
    assert.deepEqual(empty.body.data.caseStatistics.statusStats, [
        { status: "Open", count: 0 },
        { status: "Under Investigation", count: 0 },
        { status: "Court Proceedings", count: 0 },
        { status: "Closed", count: 0 },
        { status: "Reopened", count: 0 },
    ]);
});

test("case statistics apply case status and combined filters without duplicate linked records", async () => {
    const get = (query) => request(app)
        .get(`/api/reports/crime-statistics?${query}`)
        .set("Authorization", `Bearer ${officerAToken}`);

    const closed = await get("caseStatus=Closed");
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.totalFirs, 1);
    assert.deepEqual(closed.body.data.statusStats, [{ status: "Closed", count: 1 }]);
    assert.equal(closed.body.data.caseStatistics.totalCases, 1);
    assert.equal(closed.body.data.caseStatistics.closedCases, 1);

    const combined = await get("fromDate=2026-02-10&toDate=2026-02-10&caseStatus=Closed&crimeType=Fraud&city=Bengaluru&policeStation=Statistics%20Station");
    assert.equal(combined.status, 200);
    assert.equal(combined.body.data.caseStatistics.totalCases, 1);
    assert.deepEqual(combined.body.data.caseStatistics.crimeTypeStats, [{ crimeType: "Fraud", count: 1 }]);
    assert.deepEqual(combined.body.data.caseStatistics.locationStats, [{ city: "Bengaluru", state: "Karnataka", count: 1 }]);
    assert.deepEqual(combined.body.data.caseStatistics.policeStationStats, [{ policeStation: "Statistics Station", count: 1 }]);

    const noMatch = await get("fromDate=2025-01-01&toDate=2025-12-31");
    assert.equal(noMatch.status, 200);
    assert.equal(noMatch.body.data.caseStatistics.totalCases, 0);
    assert.deepEqual(noMatch.body.data.caseStatistics.monthlyStats, []);
});

test("case geography reports incomplete source locations separately", async () => {
    const missingLocationFirId = new mongoose.Types.ObjectId();
    await FIR.collection.insertOne({
        _id: missingLocationFirId,
        firNo: "STATS-MISSING-LOCATION",
        date: new Date("2026-03-01T00:00:00.000Z"),
        policeStation: "Statistics Station",
        complaint: { complainantName: "Synthetic", complaintText: "Synthetic fixture" },
        description: "Synthetic incomplete geography fixture",
        crimeType: "Other",
        location: { address: "1 Test Road", state: " " },
        registeredBy: officerA._id,
        criminalIds: [],
        status: "Open",
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    await Case.create({
        caseNo: "CS-STATS-MISSING-LOCATION",
        firId: missingLocationFirId,
        assignedOfficerIds: [officerA._id],
        criminalIds: [],
        title: "Incomplete location fixture",
        description: "Synthetic case with incomplete source geography",
        startDate: "2026-03-01",
        status: "Court Proceedings",
        priority: "Medium",
    });

    const response = await request(app)
        .get("/api/reports/crime-statistics?fromDate=2026-03-01&toDate=2026-03-01")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.caseStatistics.totalCases, 1);
    assert.equal(response.body.data.caseStatistics.casesWithoutCompleteLocation, 1);
    assert.deepEqual(response.body.data.caseStatistics.locationStats, []);
    assert.deepEqual(response.body.data.caseStatistics.stateStats, []);
    await Case.deleteOne({ caseNo: "CS-STATS-MISSING-LOCATION" });
    await FIR.collection.deleteOne({ firNo: "STATS-MISSING-LOCATION" });
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

test("crime statistics returns zero-valued case results for an empty database", async () => {
    await Case.deleteMany({});
    await FIR.deleteMany({});
    const response = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${inspectorToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.totalFirs, 0);
    assert.equal(response.body.data.caseStatistics.totalCases, 0);
    assert.equal(response.body.data.caseStatistics.openCases, 0);
    assert.equal(response.body.data.caseStatistics.closedCases, 0);
    assert.deepEqual(response.body.data.caseStatistics.monthlyStats, []);
});
