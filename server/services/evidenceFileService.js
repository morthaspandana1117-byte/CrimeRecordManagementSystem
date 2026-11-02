const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const DEFAULT_LIMIT = 10 * 1024 * 1024;
const HARD_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const resolveUploadLimit = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return DEFAULT_LIMIT;
    const parsed = Number(String(value).trim());
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= HARD_MAX_UPLOAD_BYTES
        ? parsed
        : DEFAULT_LIMIT;
};

const MAX_UPLOAD_BYTES = resolveUploadLimit(process.env.EVIDENCE_UPLOAD_MAX_BYTES);

const getProspectiveRealPath = (candidatePath) => {
    let cursor = path.resolve(candidatePath);
    const missingParts = [];
    while (!fs.existsSync(cursor)) {
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error("Evidence storage path cannot be resolved");
        missingParts.unshift(path.basename(cursor));
        cursor = parent;
    }
    return path.resolve(fs.realpathSync(cursor), ...missingParts);
};

const isPathInside = (basePath, targetPath, platform = process.platform) => {
    const pathApi = platform === "win32" ? path.win32 : path;
    const normalize = (value) => platform === "win32" ? value.toLowerCase() : value;
    const base = normalize(pathApi.resolve(basePath));
    const target = normalize(pathApi.resolve(targetPath));
    const relative = pathApi.relative(base, target);
    return relative === "" || (!pathApi.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`));
};

const getStorageDirectory = () => {
    const configured = process.env.EVIDENCE_STORAGE_DIR;
    const candidate = path.resolve(configured || path.join(__dirname, "..", "private-evidence"));
    const projectDirectory = path.resolve(__dirname, "..", "..");
    const storagePath = getProspectiveRealPath(candidate);
    const publicDirectories = [
        path.join(projectDirectory, "client", "public"),
        path.join(projectDirectory, "server", "public"),
    ].map(getProspectiveRealPath);

    if (publicDirectories.some((publicDirectory) => isPathInside(publicDirectory, storagePath))) {
        throw new Error("Evidence storage must be outside publicly served directories");
    }

    fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 });
    const realStoragePath = fs.realpathSync(storagePath);
    if (publicDirectories.some((publicDirectory) => isPathInside(publicDirectory, realStoragePath))) {
        throw new Error("Evidence storage must be outside publicly served directories");
    }
    return realStoragePath;
};

const resolveStoredPath = (storedFilename) => {
    if (typeof storedFilename !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(storedFilename)) {
        throw new Error("Invalid stored evidence identifier");
    }
    const root = getStorageDirectory();
    const resolved = path.resolve(root, storedFilename);
    if (!isPathInside(root, resolved) || path.dirname(resolved) !== root) throw new Error("Invalid stored evidence path");
    return resolved;
};

const hashBuffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const saveBuffer = async (buffer) => {
    if (!Buffer.isBuffer(buffer)) throw new TypeError("Evidence bytes are required");
    if (buffer.length > MAX_UPLOAD_BYTES) {
        const error = new Error("Evidence file exceeds the upload size limit");
        error.code = "EVIDENCE_FILE_TOO_LARGE";
        throw error;
    }
    const storedFilename = crypto.randomUUID();
    const destination = resolveStoredPath(storedFilename);
    try {
        await pipeline(Readable.from(buffer), fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
        return { storedFilename, fileHash: hashBuffer(buffer), fileSize: buffer.length };
    } catch (error) {
        try {
            await fs.promises.rm(destination, { force: true });
        } catch (cleanupError) {
            error.cleanupFailed = true;
            error.storedFilename = storedFilename;
            error.cleanupErrorCode = cleanupError.code;
        }
        throw error;
    }
};

const readStoredFile = (storedFilename) => {
    const storedPath = resolveStoredPath(storedFilename);
    const root = path.dirname(storedPath);
    let descriptor;
    try {
        const noFollow = fs.constants.O_NOFOLLOW || 0;
        // lstat covers platforms without O_NOFOLLOW; O_NOFOLLOW closes the
        // check/open race on platforms that provide it.
        const pathInfo = fs.lstatSync(storedPath);
        if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
            const error = new Error("Stored evidence is not a regular file");
            error.code = "EINVALIDTYPE";
            throw error;
        }
        descriptor = fs.openSync(storedPath, fs.constants.O_RDONLY | noFollow);
        const descriptorInfo = fs.fstatSync(descriptor);
        if (!descriptorInfo.isFile()) {
            const error = new Error("Stored evidence is not a regular file");
            error.code = "EINVALIDTYPE";
            throw error;
        }
        const realPath = fs.realpathSync(storedPath);
        if (!isPathInside(root, realPath) || path.dirname(realPath) !== root) {
            const error = new Error("Stored evidence is outside private storage");
            error.code = "EINVALIDTYPE";
            throw error;
        }
        return fs.createReadStream(null, { fd: descriptor, autoClose: true });
    } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        throw error;
    }
};

const hashStoredFile = async (storedFilename) => {
    const hash = crypto.createHash("sha256");
    for await (const chunk of readStoredFile(storedFilename)) hash.update(chunk);
    return hash.digest("hex");
};

const deleteStoredFile = async (storedFilename) => {
    try {
        await fs.promises.rm(resolveStoredPath(storedFilename));
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
};

module.exports = {
    MAX_UPLOAD_BYTES,
    DEFAULT_LIMIT,
    HARD_MAX_UPLOAD_BYTES,
    resolveUploadLimit,
    isPathInside,
    getStorageDirectory,
    resolveStoredPath,
    saveBuffer,
    readStoredFile,
    hashStoredFile,
    deleteStoredFile,
    hashBuffer,
};
