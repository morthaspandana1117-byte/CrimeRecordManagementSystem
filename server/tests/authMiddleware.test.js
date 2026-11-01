
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
    authMiddleware,
    authorizeRoles,
} = require("../middleware/authMiddleware");

const TEST_SECRET = "test-only-secret";

process.env.JWT_SECRET = TEST_SECRET;

function createResponse() {
    return {
        statusCode: null,
        body: null,

        status(code) {
            this.statusCode = code;
            return this;
        },

        json(body) {
            this.body = body;
            return this;
        },
    };
}

function createRequest(authorization) {
    return {
        headers: authorization === undefined
            ? {}
            : { authorization },
    };
}

test("authMiddleware rejects a missing authorization header", () => {
    const req = createRequest();
    const res = createResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "TOKEN_REQUIRED");
    assert.equal(nextCalled, false);
});

test("authMiddleware rejects an authorization header without Bearer", () => {
    const req = createRequest("Invalid token");
    const res = createResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "TOKEN_REQUIRED");
    assert.equal(nextCalled, false);
});

test("authMiddleware rejects an expired JWT", () => {
    const token = jwt.sign(
        { id: "test-user", role: "officer" },
        TEST_SECRET,
        { expiresIn: -1 }
    );

    const req = createRequest(`Bearer ${token}`);
    const res = createResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "TOKEN_EXPIRED");
    assert.equal(nextCalled, false);
});

test("authMiddleware rejects an invalid JWT", () => {
    const req = createRequest("Bearer invalid.token.value");
    const res = createResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "INVALID_TOKEN");
    assert.equal(nextCalled, false);
});

test("authMiddleware accepts a valid JWT and sets req.user", () => {
    const payload = {
        id: "test-user",
        role: "officer",
    };

    const token = jwt.sign(payload, TEST_SECRET);

    const req = createRequest(`Bearer ${token}`);
    const res = createResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.deepEqual(req.user.id, payload.id);
    assert.equal(req.user.role, payload.role);
    assert.equal(res.statusCode, null);
});

test("authorizeRoles allows a permitted role", () => {
    const req = {
        user: { role: "admin" },
    };
    const res = createResponse();
    let nextCalled = false;

    authorizeRoles("admin", "system_admin")(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
});

test("authorizeRoles rejects a role that is not permitted", () => {
    const req = {
        user: { role: "officer" },
    };
    const res = createResponse();
    let nextCalled = false;

    authorizeRoles("admin", "system_admin")(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "FORBIDDEN");
    assert.equal(nextCalled, false);
});

test("authorizeRoles rejects a request without req.user", () => {
    const req = {};
    const res = createResponse();
    let nextCalled = false;

    authorizeRoles("admin")(req, res, () => {
        nextCalled = true;
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "FORBIDDEN");
    assert.equal(nextCalled, false);
});
