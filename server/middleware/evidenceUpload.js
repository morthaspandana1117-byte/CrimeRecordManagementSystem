const multer = require("multer");
const { MAX_UPLOAD_BYTES } = require("../services/evidenceFileService");

const ALLOWED_SIGNATURES = new Map([
    ["application/pdf", new Set(["application/pdf"])],
    ["image/jpeg", new Set(["image/jpeg"])],
    ["image/png", new Set(["image/png"])],
    ["image/gif", new Set(["image/gif"])],
    ["image/webp", new Set(["image/webp"])],
]);
const DISPLAY_EXTENSIONS = new Map([
    ["application/pdf", ".pdf"],
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"],
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, parts: 22 },
});

const sanitizeFileName = (name = "evidence", detectedMime) => {
    const cleaned = String(name).replace(/[\\/]/g, "_").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(-180);
    const extension = DISPLAY_EXTENSIONS.get(detectedMime) || "";
    const lastDot = cleaned.lastIndexOf(".");
    const stem = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
    const safeStem = stem.replace(/[. ]+$/g, "").trim() || "evidence";
    return `${safeStem}${extension}`;
};

const detectFileType = async (buffer) => {
    const { fileTypeFromBuffer } = await import("file-type");
    return fileTypeFromBuffer(buffer);
};

const evidenceUpload = (req, res, next) => {
    upload.single("file")(req, res, async (uploadError) => {
        if (uploadError) {
            const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE";
            return res.status(tooLarge ? 413 : 400).json({
                success: false,
                message: tooLarge ? "Evidence file exceeds the upload size limit" : "Evidence upload is invalid",
                error: tooLarge ? "EVIDENCE_FILE_TOO_LARGE" : "INVALID_EVIDENCE_UPLOAD",
            });
        }
        if (!req.file) return res.status(400).json({ success: false, message: "An evidence file is required", error: "EVIDENCE_FILE_REQUIRED" });
        try {
            const detected = await detectFileType(req.file.buffer);
            const allowedMimeTypes = detected && ALLOWED_SIGNATURES.get(detected.mime);
            if (!detected || !allowedMimeTypes || !allowedMimeTypes.has(detected.mime) || req.file.mimetype !== detected.mime) {
                return res.status(415).json({ success: false, message: "Evidence file type is unsupported or does not match its content", error: "INVALID_EVIDENCE_FILE_TYPE" });
            }
            req.evidenceUpload = {
                buffer: req.file.buffer,
                fileName: sanitizeFileName(req.file.originalname, detected.mime),
                mimeType: detected.mime,
                fileSize: req.file.size,
            };
            return next();
        } catch (error) {
            console.error("Evidence signature validation failed", { name: error?.name, code: error?.code });
            return res.status(500).json({ success: false, message: "Unable to validate evidence file", error: "EVIDENCE_FILE_VALIDATION_FAILED" });
        }
    });
};

evidenceUpload.sanitizeFileName = sanitizeFileName;
evidenceUpload.ALLOWED_SIGNATURES = ALLOWED_SIGNATURES;
module.exports = evidenceUpload;
