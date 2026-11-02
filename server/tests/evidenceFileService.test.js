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

test("readStoredFile streams a regular file and rejects missing files", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "crms-evidence-read-"));
    process.env.EVIDENCE_STORAGE_DIR = directory;
    t.after(async () => {
        delete process.env.EVIDENCE_STORAGE_DIR;
        await fs.rm(directory, { recursive: true, force: true });
    });

    const stored = await service.saveBuffer(Buffer.from("private evidence bytes"));
    const chunks = [];
    for await (const chunk of service.readStoredFile(stored.storedFilename)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from("private evidence bytes"));

    await fs.rm(service.resolveStoredPath(stored.storedFilename));
    assert.throws(() => service.readStoredFile(stored.storedFilename), { code: "ENOENT" });

    const directoryEntry = "123e4567-e89b-42d3-a456-426614174001";
    await fs.mkdir(service.resolveStoredPath(directoryEntry));
    assert.throws(() => service.readStoredFile(directoryEntry), { code: "EINVALIDTYPE" });
});

test("readStoredFile rejects symbolic links to files outside private storage", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "crms-evidence-symlink-"));
    const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "crms-evidence-outside-"));
    const original = process.env.EVIDENCE_STORAGE_DIR;
    process.env.EVIDENCE_STORAGE_DIR = directory;
    t.after(async () => {
        if (original === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
        else process.env.EVIDENCE_STORAGE_DIR = original;
        await fs.rm(directory, { recursive: true, force: true });
        await fs.rm(outsideDirectory, { recursive: true, force: true });
    });

    const filename = "123e4567-e89b-42d3-a456-426614174000";
    const outsideFile = path.join(outsideDirectory, "outside-evidence.txt");
    await fs.writeFile(outsideFile, "must not be served");
    try {
        await fs.symlink(outsideFile, path.join(directory, filename), "file");
    } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error.code)) {
            t.skip(`Symbolic links are unavailable: ${error.code}`);
            return;
        }
        throw error;
    }

    assert.throws(() => service.readStoredFile(filename), { code: "EINVALIDTYPE" });
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
