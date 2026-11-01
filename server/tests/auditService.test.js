const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { mock } = require("node:test");

const AuditLog = require("../models/AuditLog");
const auditService = require("../services/auditService");

const auditArguments = () => ({
    actor: new mongoose.Types.ObjectId(),
    action: "EVIDENCE_FILE_UPLOADED",
    entityType: "Evidence",
    entityId: new mongoose.Types.ObjectId(),
    after: { evidenceId: "E-AUDIT-IDEMPOTENCY", fileHash: "a".repeat(64) },
    method: "POST",
    path: "/api/evidence/with-file",
    auditId: new mongoose.Types.ObjectId(),
});

test("audit create retry accepts only an existing record with matching identity and action", async (t) => {
    const args = auditArguments();
    const existing = {
        _id: args.auditId,
        entityId: args.entityId,
        entityType: args.entityType,
        action: args.action,
    };
    t.mock.method(AuditLog, "create", async () => { throw new Error("ambiguous audit create result"); });
    t.mock.method(AuditLog, "findById", () => ({
        select: () => ({ lean: async () => existing }),
    }));

    assert.equal(await auditService.log(args), existing);
});

test("audit create retry propagates its original error when the existing record mismatches", async (t) => {
    const args = auditArguments();
    const creationError = new Error("audit create failed");
    const mismatched = {
        _id: args.auditId,
        entityId: new mongoose.Types.ObjectId(),
        entityType: args.entityType,
        action: args.action,
    };
    t.mock.method(AuditLog, "create", async () => { throw creationError; });
    t.mock.method(AuditLog, "findById", () => ({
        select: () => ({ lean: async () => mismatched }),
    }));

    await assert.rejects(auditService.log(args), (error) => error === creationError);
});
