const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const service = require("../services/evidenceFileService");

test("stores exact evidence bytes and calculates a SHA-256 digest", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "crms-evidence-"));
    process.env.EVIDENCE_STORAGE_DIR = directory;
    t.after(async () => {
        delete process.env.EVIDENCE_STORAGE_DIR;
        await fs.rm(directory, { recursive: true, force: true });
    });

    const bytes = Buffer.from("%PDF-1.7\nCRMS test bytes\n", "ascii");
    const stored = await service.saveBuffer(bytes);
    assert.match(stored.fileHash, /^[a-f0-9]{64}$/);
    assert.equal(stored.fileHash, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(await fs.readFile(service.resolveStoredPath(stored.storedFilename)), bytes);
    assert.equal(await service.hashStoredFile(stored.storedFilename), stored.fileHash);
    assert.equal(await service.deleteStoredFile(stored.storedFilename), true);
    assert.equal(await service.deleteStoredFile(stored.storedFilename), false);
});

test("rejects client-controlled storage paths", () => {
    assert.throws(() => service.resolveStoredPath("..\\outside.pdf"), /Invalid stored evidence identifier/);
    assert.throws(() => service.resolveStoredPath("../../outside"), /Invalid stored evidence identifier/);
});

test("rejects public storage paths and symlink aliases", async (t) => {
    const original = process.env.EVIDENCE_STORAGE_DIR;
    const publicDirectory = path.resolve(__dirname, "..", "..", "client", "public");
    process.env.EVIDENCE_STORAGE_DIR = path.join(publicDirectory, "crms-evidence-test");
    assert.throws(() => service.getStorageDirectory(), /publicly served directories/);

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crms-evidence-alias-"));
    const alias = path.join(temporaryRoot, "public-alias");
    try {
        await fs.symlink(publicDirectory, alias, "junction");
        process.env.EVIDENCE_STORAGE_DIR = path.join(alias, "crms-evidence-test");
        assert.throws(() => service.getStorageDirectory(), /publicly served directories/);
    } finally {
        if (original === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
        else process.env.EVIDENCE_STORAGE_DIR = original;
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("compares Windows storage paths without case sensitivity", () => {
    assert.equal(service.isPathInside("C:\\CRMS\\client\\public", "c:\\crms\\CLIENT\\PUBLIC\\evidence", "win32"), true);
    assert.equal(service.isPathInside("C:\\CRMS\\client\\public", "C:\\CRMS\\client\\public-backup", "win32"), false);
});

test("uses a 10 MB default and rejects invalid or excessive configured limits", () => {
    assert.equal(service.MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit(undefined), 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit("5"), 5);
    assert.equal(service.resolveUploadLimit("5mb"), 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit("0"), 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit("-1"), 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit(String(service.HARD_MAX_UPLOAD_BYTES + 1)), 10 * 1024 * 1024);
    assert.equal(service.resolveUploadLimit(String(service.HARD_MAX_UPLOAD_BYTES)), service.HARD_MAX_UPLOAD_BYTES);
});

test("storage service enforces the same configured limit as multipart middleware", async () => {
    const oversized = Buffer.alloc(service.MAX_UPLOAD_BYTES + 1);
    await assert.rejects(service.saveBuffer(oversized), { code: "EVIDENCE_FILE_TOO_LARGE" });
});
