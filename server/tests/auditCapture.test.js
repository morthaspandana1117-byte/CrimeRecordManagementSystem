const test = require("node:test");
const assert = require("node:assert/strict");
const auditCapture = require("../middleware/auditCapture");
const auditService = require("../services/auditService");

test("generic mutation preserves the committed response and signals an audit failure", async (t) => {
    t.mock.method(auditService, "log", async () => {
        throw new Error("simulated audit failure");
    });

    const responses = [];
    const res = {
        statusCode: 201,
        headersSent: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers = { ...(this.headers || {}), [name]: value };
        },
        json(body) {
            responses.push({ statusCode: this.statusCode, body });
            return this;
        },
    };
    const req = {
        method: "POST",
        baseUrl: "/api/criminals",
        path: "/",
        body: {},
    };

    await auditCapture(req, res, () => {});
    res.json({ success: true, data: { _id: "507f1f77bcf86cd799439011" } });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(responses.at(-1), { statusCode: 201, body: { success: true, data: { _id: "507f1f77bcf86cd799439011" } } });
    assert.equal(res.headers["X-Audit-Logging-Failed"], "true");
});
