const mongoose = require("mongoose");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isValidDate = (value) => value && !Number.isNaN(new Date(value).getTime());

const invalid = (res, message, error = "INVALID_REQUEST") =>
    res.status(400).json({ success: false, message, error });

const notFound = (res, resource) =>
    res.status(404).json({ success: false, message: `${resource} not found`, error: `${resource.toUpperCase().replace(/ /g, "_")}_NOT_FOUND` });

const conflict = (res, message, error = "DUPLICATE_RECORD") =>
    res.status(409).json({ success: false, message, error });

const validateObjectId = (res, value, field) => {
    if (!isValidObjectId(value)) {
        invalid(res, `${field} must be a valid ObjectId`, `INVALID_${field.toUpperCase()}`);
        return false;
    }
    return true;
};

const validateReference = async (res, Model, value, field) => {
    if (!validateObjectId(res, value, field)) return false;
    if (!await Model.exists({ _id: value })) {
        notFound(res, field);
        return false;
    }
    return true;
};

const validateReferences = async (res, Model, values, field) => {
    if (!Array.isArray(values) || values.length === 0) {
        invalid(res, `${field} must be a non-empty array`, `INVALID_${field.toUpperCase()}`);
        return false;
    }
    if (values.some((value) => !isValidObjectId(value))) {
        invalid(res, `${field} contains an invalid ObjectId`, `INVALID_${field.toUpperCase()}`);
        return false;
    }
    const count = await Model.countDocuments({ _id: { $in: values } });
    if (count !== new Set(values.map(String)).size) {
        invalid(res, `${field} contains a reference that does not exist`, `INVALID_${field.toUpperCase()}_REFERENCE`);
        return false;
    }
    return true;
};

const handleError = (res, error, context) => {
    console.error(`${context}:`, error);
    if (error.code === 11000) return conflict(res, "A record with a unique field already exists", "DUPLICATE_RECORD");
    if (error.name === "ValidationError" || error.name === "CastError") return invalid(res, error.message, "VALIDATION_ERROR");
    return res.status(500).json({ success: false, message: "Server error", error: "SERVER_ERROR" });
};

module.exports = { isValidObjectId, isNonEmptyString, isValidDate, invalid, notFound, conflict, validateObjectId, validateReference, validateReferences, handleError };
