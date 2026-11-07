const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "crime-statistics-integration-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const PoliceStation = require("../models/PoliceStation");

let mongoServer;
let app;
let officerA;
let officerB;
let inspector;
let officerAToken;
let inspectorToken;
let adminToken;
let station;
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
        stationId: station._id,
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
    policeStationId: station._id,
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
    station = await PoliceStation.create({ name: "Statistics Station", code: "STATS-01" });
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

test("statistics reconcile with source records after FIR create, update, and deletion", async () => {
    const expectedSnapshot = async () => {
        const firs = await FIR.find({ registeredBy: officerA._id }).lean();
        const firIds = firs.map(({ _id }) => _id);
        const cases = await Case.find({ firId: { $in: firIds } }).lean();
        const linkedFirById = new Map(firs.map((fir) => [String(fir._id), fir]));
        const group = (records, keyFor) => {
            const counts = new Map();
            for (const record of records) {
                const key = keyFor(record);
                counts.set(key, (counts.get(key) || 0) + 1);
            }
            return [...counts.entries()]
                .sort(([left], [right]) => left === right ? 0
                    : left === null ? -1
                        : right === null ? 1
                            : String(left) < String(right) ? -1 : 1)
                .map(([key, count]) => [key, count]);
        };
        const dateGroup = (value, format) => {
            const parsed = value ? new Date(value) : null;
            if (!parsed || Number.isNaN(parsed.getTime())) return "Unknown";
            const date = parsed.toISOString();
            if (format === "date") return date.slice(0, 10);
            if (format === "month") return date.slice(0, 7);
            return date.slice(0, 4);
        };
        const caseStatuses = ["Open", "Under Investigation", "Court Proceedings", "Closed", "Reopened"];
        const groupedCaseStatuses = group(cases, ({ status }) => status ?? null);
        const knownStatusCounts = new Map(groupedCaseStatuses);
        const knownStatuses = caseStatuses.map((status) => [status, knownStatusCounts.get(status) || 0]);
        const legacyStatuses = groupedCaseStatuses.filter(([status]) => !caseStatuses.includes(status));

        return {
            firs,
            cases,
            expected: {
                totalFirs: firs.length,
                crimeTypeStats: group(firs, ({ crimeType }) => crimeType ?? null)
                    .map(([crimeType, count]) => ({ crimeType, count })),
                statusStats: group(firs, ({ status }) => status ?? null)
                    .map(([status, count]) => ({ status, count })),
                dateStats: group(firs, ({ date }) => dateGroup(date, "date"))
                    .map(([date, count]) => ({ date, count })),
                totalCases: cases.length,
                caseStatusStats: [...knownStatuses, ...legacyStatuses]
                    .map(([status, count]) => ({ status, count })),
                monthlyStats: group(cases, ({ startDate }) => dateGroup(startDate, "month"))
                    .map(([month, count]) => ({ month, count })),
                yearlyStats: group(cases, ({ startDate }) => dateGroup(startDate, "year"))
                    .map(([year, count]) => ({ year, count })),
                caseCrimeTypeStats: group(cases, (record) => {
                    const crimeType = linkedFirById.get(String(record.firId))?.crimeType;
                    return typeof crimeType === "string" && crimeType.trim()
                        ? crimeType.trim()
                        : "Unspecified";
                }).map(([crimeType, count]) => ({ crimeType, count })),
            },
        };
    };
    const assertMatchesSource = async () => {
        const { expected } = await expectedSnapshot();
        const response = await request(app)
            .get("/api/reports/crime-statistics")
            .set("Authorization", `Bearer ${officerAToken}`);
        assert.equal(response.status, 200);
        assert.equal(response.body.data.totalFirs, expected.totalFirs);
        assert.deepEqual(response.body.data.crimeTypeStats, expected.crimeTypeStats);
        assert.deepEqual(response.body.data.statusStats, expected.statusStats);
        assert.deepEqual(response.body.data.dateStats, expected.dateStats);
        assert.equal(response.body.data.caseStatistics.totalCases, expected.totalCases);
        assert.deepEqual(response.body.data.caseStatistics.statusStats, expected.caseStatusStats);
        assert.deepEqual(response.body.data.caseStatistics.monthlyStats, expected.monthlyStats);
        assert.deepEqual(response.body.data.caseStatistics.yearlyStats, expected.yearlyStats);
        assert.deepEqual(response.body.data.caseStatistics.crimeTypeStats, expected.caseCrimeTypeStats);
        return response.body.data;
    };

    await assertMatchesSource();
    const criminal = await Criminal.create({
        criminalId: "STATS-MUTATION-CRIMINAL",
        fullName: "Synthetic mutation fixture",
        dateOfBirth: "1990-01-01",
        gender: "Other",
        address: "Synthetic test address",
        status: "active",
    });
    const created = await request(app)
        .post("/api/firs")
        .set("Authorization", `Bearer ${officerAToken}`)
        .send({
            firNo: "STATS-MUTATION-FIR",
            date: "2026-03-01",
            policeStation: "Statistics Station",
            policeStationId: String(station._id),
            complaint: { complainantName: "Mutation fixture", complaintText: "Create/update statistics fixture" },
            description: "Synthetic mutation statistics fixture",
            crimeType: "Theft",
            location: { address: "1 Test Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
            criminalIds: [criminal._id.toString()],
        });
    assert.equal(created.status, 201);
    const afterCreate = await assertMatchesSource();

    const linkedCase = await createCase(created.body.data, {
        caseNo: "CS-STATS-MUTATION-FIR",
        startDate: "2026-03-01",
        status: "Open",
        officerId: officerA._id,
    });
    const afterLink = await assertMatchesSource();
    assert.equal(afterLink.totalFirs, afterCreate.totalFirs);
    assert.equal(afterLink.caseStatistics.totalCases, afterCreate.caseStatistics.totalCases + 1);

    const updated = await request(app)
        .put(`/api/firs/${created.body.data._id}`)
        .set("Authorization", `Bearer ${officerAToken}`)
        .send({ date: "2026-03-02", crimeType: "Fraud", status: "Closed" });
    assert.equal(updated.status, 200);
    const afterUpdate = await assertMatchesSource();
    assert.equal(afterUpdate.crimeTypeStats.find(({ crimeType }) => crimeType === "Fraud").count, 2);

    await Case.deleteOne({ _id: linkedCase._id });
    await FIR.deleteOne({ _id: created.body.data._id });
    const afterDelete = await assertMatchesSource();
    assert.equal(afterDelete.totalFirs, afterCreate.totalFirs - 1);
    assert.equal(afterDelete.caseStatistics.totalCases, afterCreate.caseStatistics.totalCases);
});

test("statistics retain legacy values and count records with missing or invalid dates", async () => {
    const missingFieldsId = new mongoose.Types.ObjectId();
    const legacyValueId = new mongoose.Types.ObjectId();
    await FIR.collection.insertMany([
        {
            _id: missingFieldsId,
            firNo: "STATS-LEGACY-MISSING",
            registeredBy: officerA._id,
        },
        {
            _id: legacyValueId,
            firNo: "STATS-LEGACY-VALUES",
            registeredBy: officerA._id,
            date: "invalid legacy date",
            crimeType: "Legacy Crime",
            status: "Legacy FIR Status",
        },
    ]);
    await Case.collection.insertMany([
        {
            caseNo: "CS-STATS-LEGACY-INVALID-DATE",
            firId: legacyValueId,
            status: "Legacy Case Status",
            startDate: "invalid legacy date",
        },
        {
            caseNo: "CS-STATS-LEGACY-MISSING-DATE",
            firId: missingFieldsId,
        },
    ]);

    const sourceFirs = await FIR.find({ registeredBy: officerA._id }).lean();
    const sourceCases = await Case.find({ firId: { $in: sourceFirs.map(({ _id }) => _id) } }).lean();
    const response = await request(app)
        .get("/api/reports/crime-statistics")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.totalFirs, sourceFirs.length);
    assert.equal(response.body.data.caseStatistics.totalCases, sourceCases.length);
    assert.ok(response.body.data.crimeTypeStats.some(({ crimeType, count }) => crimeType === "Legacy Crime" && count === 1));
    assert.ok(response.body.data.crimeTypeStats.some(({ crimeType, count }) => crimeType === null && count === 1));
    assert.ok(response.body.data.statusStats.some(({ status, count }) => status === "Legacy FIR Status" && count === 1));
    assert.ok(response.body.data.statusStats.some(({ status, count }) => status === null && count === 1));
    assert.equal(response.body.data.dateStats.filter(({ date }) => date === "Unknown").reduce((sum, row) => sum + row.count, 0), 2);
    assert.ok(response.body.data.caseStatistics.statusStats.some(({ status, count }) => status === "Legacy Case Status" && count === 1));
    assert.ok(response.body.data.caseStatistics.statusStats.some(({ status, count }) => status === null && count === 1));
    assert.ok(response.body.data.caseStatistics.monthlyStats.some(({ month, count }) => month === "Unknown" && count === 2));
    assert.ok(response.body.data.caseStatistics.yearlyStats.some(({ year, count }) => year === "Unknown" && count === 2));
});

test("date range boundaries include UTC leap day and separate month and year groups", async () => {
    const dateFixtures = [
        ["STATS-BOUNDARY-2023", "2023-12-31T23:59:59.999Z"],
        ["STATS-BOUNDARY-2024-START", "2024-01-01T00:00:00.000Z"],
        ["STATS-BOUNDARY-LEAP", "2024-02-29T23:59:59.999Z"],
        ["STATS-BOUNDARY-MARCH", "2024-03-01T00:00:00.000Z"],
    ];
    for (const [firNo, date] of dateFixtures) {
        const fir = await createFIR(officerA._id, {
            firNo,
            date,
            crimeType: "Kidnapping",
            status: "Open",
            city: "Bengaluru",
        });
        await createCase(fir, {
            caseNo: `CS-${firNo}`,
            startDate: date,
            status: "Open",
            officerId: officerA._id,
        });
    }

    const leapDay = await request(app)
        .get("/api/reports/crime-statistics?crimeType=Kidnapping&fromDate=2024-02-29&toDate=2024-02-29")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(leapDay.status, 200);
    assert.equal(leapDay.body.data.totalFirs, 1);
    assert.deepEqual(leapDay.body.data.dateStats, [{ date: "2024-02-29", count: 1 }]);
    assert.equal(leapDay.body.data.caseStatistics.totalCases, 1);
    assert.deepEqual(leapDay.body.data.caseStatistics.monthlyStats, [{ month: "2024-02", count: 1 }]);
    assert.deepEqual(leapDay.body.data.caseStatistics.yearlyStats, [{ year: "2024", count: 1 }]);

    const allBoundaryDates = await request(app)
        .get("/api/reports/crime-statistics?crimeType=Kidnapping")
        .set("Authorization", `Bearer ${officerAToken}`);
    assert.equal(allBoundaryDates.status, 200);
    assert.equal(allBoundaryDates.body.data.totalFirs, 4);
    assert.deepEqual(allBoundaryDates.body.data.caseStatistics.monthlyStats, [
        { month: "2023-12", count: 1 },
        { month: "2024-01", count: 1 },
        { month: "2024-02", count: 1 },
        { month: "2024-03", count: 1 },
    ]);
    assert.deepEqual(allBoundaryDates.body.data.caseStatistics.yearlyStats, [
        { year: "2023", count: 1 },
        { year: "2024", count: 3 },
    ]);
});

test("statistics and map endpoints reject invalid, expired, and inactive-account tokens", async () => {
    const expiredToken = jwt.sign(
        { userId: officerA.userId.toString(), role: "officer" },
        process.env.JWT_SECRET,
        { expiresIn: -1 },
    );
    const inactiveUser = await User.create({
        username: "stats-inactive-user",
        email: "stats-inactive-user@crms.test",
        passwordHash: await bcrypt.hash(password, 4),
        role: "officer",
        status: "approved",
        isActive: false,
    });
    const inactiveToken = jwt.sign(
        { userId: inactiveUser._id.toString(), role: "officer" },
        process.env.JWT_SECRET,
    );

    for (const token of ["invalid-token", expiredToken]) {
        for (const path of ["/api/reports/crime-statistics", "/api/firs/map"]) {
            const response = await request(app).get(path).set("Authorization", `Bearer ${token}`);
            assert.equal(response.status, 401, `${path} must reject invalid or expired tokens`);
        }
    }
    for (const path of ["/api/reports/crime-statistics", "/api/firs/map"]) {
        const response = await request(app).get(path).set("Authorization", `Bearer ${inactiveToken}`);
        assert.equal(response.status, 403, `${path} must reject inactive accounts`);
        assert.equal(response.body.error, "ACCOUNT_INACTIVE");
    }
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
