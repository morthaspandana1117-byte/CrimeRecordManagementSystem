const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "ai-evaluation-test-secret";

const createApp = require("../app");
const User = require("../models/User");
const Officer = require("../models/Officer");
const AIEvaluationResult = require("../models/AIEvaluationResult");

let mongoServer;
let app;
let reviewerToken;
let officerToken;
let regularUser;

test.before(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const mongoUri = mongoServer.getUri("crms-ai-eval");
    await mongoose.connect(mongoUri);
    app = createApp();

    const passwordHash = await bcrypt.hash("AiEval@123", 10);
    const adminUser = await User.create({
        username: "ai-admin",
        email: "ai-admin@crms.test",
        passwordHash,
        role: "system_admin",
        status: "approved",
        isActive: true,
    });
    regularUser = await User.create({
        username: "ai-reviewer",
        email: "ai-reviewer@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    await Officer.create({
        userId: regularUser._id,
        officerId: "AI-REV-001",
        badgeNumber: "AI0011",
        name: "AI Reviewer",
        rank: "inspector",
        department: "Criminal Investigation",
        station: "Central Station",
        phoneNumber: "5551112222",
        address: "Test Street 1",
        joiningDate: "2020-01-01",
        status: "active",
    });
    const unauthorizedUser = await User.create({
        username: "ai-unauthorized",
        email: "ai-unauthorized@crms.test",
        passwordHash,
        role: "officer",
        status: "approved",
        isActive: true,
    });
    await Officer.create({
        userId: unauthorizedUser._id,
        officerId: "AI-LOW-001",
        badgeNumber: "AI0021",
        name: "Junior Officer",
        rank: "constable",
        department: "Law and Order",
        station: "Central Station",
        phoneNumber: "5551113333",
        address: "Test Street 2",
        joiningDate: "2021-01-01",
        status: "active",
    });

    const adminLogin = await request(app).post("/api/auth/login").send({ username: adminUser.username, password: "AiEval@123" });
    const reviewerLogin = await request(app).post("/api/auth/login").send({ username: regularUser.username, password: "AiEval@123" });
    const officerLogin = await request(app).post("/api/auth/login").send({ username: unauthorizedUser.username, password: "AiEval@123" });

    assert.equal(adminLogin.status, 200);
    assert.equal(reviewerLogin.status, 200);
    assert.equal(officerLogin.status, 200);
    reviewerToken = reviewerLogin.body.token;
    officerToken = officerLogin.body.token;
});

test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
});

test("authorized reviewer can run evaluation and summary statistics are calculated", async () => {
    const response = await request(app)
        .post("/api/ai-evaluation/run")
        .set("Authorization", `Bearer ${reviewerToken}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.length, 5);
    assert.equal(response.body.summary.totalTests, 5);
    assert.equal(response.body.summary.failedTests, 3);
    assert.equal(response.body.summary.passedTests, 2);
    assert.equal(response.body.summary.criticalViolations, 1);
    assert.ok(response.body.summary.passPercentage > 0);

    const storedResults = await AIEvaluationResult.countDocuments();
    assert.equal(storedResults, 5);

    const summaryResponse = await request(app)
        .get("/api/ai-evaluation/summary")
        .set("Authorization", `Bearer ${reviewerToken}`);

    assert.equal(summaryResponse.status, 200);
    assert.equal(summaryResponse.body.data.totalTests, 5);
    assert.equal(summaryResponse.body.data.failedTests, 3);
});

test("results can be filtered, paginated, and retrieved individually", async () => {
    const filtered = await request(app)
        .get("/api/ai-evaluation/results")
        .query({ category: "Sensitive Data Handling", status: "PASS", page: 1, limit: 10 })
        .set("Authorization", `Bearer ${reviewerToken}`);

    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.success, true);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.pagination.totalRecords, 1);

    const resultId = filtered.body.data[0]._id;
    const singleResult = await request(app)
        .get(`/api/ai-evaluation/results/${resultId}`)
        .set("Authorization", `Bearer ${reviewerToken}`);

    assert.equal(singleResult.status, 200);
    assert.equal(singleResult.body.data.testCaseId, "AI-EVAL-SENSITIVE-001");
    assert.equal(singleResult.body.data.status, "PASS");
});

test("unauthorized users cannot access evaluation controls and invalid IDs are rejected", async () => {
    const unauthorized = await request(app)
        .post("/api/ai-evaluation/run")
        .set("Authorization", `Bearer ${officerToken}`);
    assert.equal(unauthorized.status, 403);

    const unauthenticated = await request(app)
        .get("/api/ai-evaluation/results");
    assert.equal(unauthenticated.status, 401);

    const missingResult = await request(app)
        .get("/api/ai-evaluation/results/507f1f77bcf86cd799439011")
        .set("Authorization", `Bearer ${reviewerToken}`);
    assert.equal(missingResult.status, 404);

    const invalidResult = await request(app)
        .get("/api/ai-evaluation/results/not-a-valid-id")
        .set("Authorization", `Bearer ${reviewerToken}`);
    assert.equal(invalidResult.status, 400);
});

test("health endpoint reports the evaluation module is operational", async () => {
    const response = await request(app)
        .get("/api/ai-evaluation/health")
        .set("Authorization", `Bearer ${reviewerToken}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, "operational");
    assert.equal(response.body.data.service, "aiEvaluation");
});
