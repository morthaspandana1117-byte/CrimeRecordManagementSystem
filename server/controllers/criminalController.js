const Criminal = require("../models/Criminal");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    handleError,
} = require("./controllerUtils");

const validStatuses = [
    "active",
    "inactive",
    "wanted",
    "arrested",
    "released",
    "deceased",
];

const required = [
    "criminalId",
    "fullName",
    "dateOfBirth",
    "gender",
    "address",
    "status",
];

const allowedFields = [
    "fullName",
    "dateOfBirth",
    "gender",
    "address",
    "phoneNumber",
    "identificationDetails",
    "photo",
];

const normalizeCriminalStatus = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return validStatuses.includes(normalized) ? normalized : null;
};

const validateCriminalStatus = (value) => normalizeCriminalStatus(value) !== null;

const buildCriminalQueryFilters = ({ search, status } = {}) => {
    const filter = {};

    if (status !== undefined) {
        const normalizedStatus = normalizeCriminalStatus(status);
        if (normalizedStatus === null) {
            return {
                valid: false,
                error: "INVALID_CRIMINAL_STATUS",
            };
        }
        filter.status = normalizedStatus;
    }

    const searchTerm = typeof search === "string" ? search.trim() : "";
    if (searchTerm) {
        filter.$or = [
            { criminalId: { $regex: searchTerm, $options: "i" } },
            { fullName: { $regex: searchTerm, $options: "i" } },
        ];
    }

    return { valid: true, filter };
};

const validateCriminal = (body, partial = false) => {
    if (!partial) {
        const missing = required.find(
            (field) =>
                body[field] === undefined ||
                body[field] === null ||
                (typeof body[field] === "string" && body[field].trim() === ""),
        );
        if (missing) {
            return "All required criminal fields must be provided";
        }
    }

    if (body.dateOfBirth !== undefined && !isValidDate(body.dateOfBirth)) {
        return "dateOfBirth must be a valid date";
    }

    if (
        body.gender !== undefined &&
        !["Male", "Female", "Other"].includes(body.gender)
    ) {
        return "gender must be one of: Male, Female, Other";
    }

    if (
        body.status !== undefined &&
        normalizeCriminalStatus(body.status) === null
    ) {
        return "status must be one of: active, inactive, wanted, arrested, released, deceased";
    }

    if (
        body.phoneNumber !== undefined &&
        body.phoneNumber !== "" &&
        !/^[0-9+\-\s()]{7,20}$/.test(body.phoneNumber.trim())
    ) {
        return "phoneNumber must be a valid phone number";
    }

    if (
        body.photo !== undefined &&
        body.photo !== "" &&
        !/^https?:\/\//i.test(body.photo.trim())
    ) {
        return "photo must be a valid URL";
    }

    if (
        body.identificationDetails !== undefined &&
        body.identificationDetails !== null &&
        typeof body.identificationDetails === "object" &&
        !(
            (
                body.identificationDetails.type === undefined ||
                isNonEmptyString(body.identificationDetails.type)
            ) &&
            (
                body.identificationDetails.number === undefined ||
                isNonEmptyString(body.identificationDetails.number)
            ) &&
            (
                body.identificationDetails.description === undefined ||
                isNonEmptyString(body.identificationDetails.description)
            )
        )
    ) {
        return "identificationDetails contains invalid values";
    }

    return null;
};

const createCriminal = async (req, res) => {
    try {
        const message = validateCriminal(req.body);
        if (message) return invalid(res, message);

        const criminal = await Criminal.create(req.body);
        return res.status(201).json({
            success: true,
            message: "Criminal created successfully",
            data: criminal,
        });
    } catch (error) {
        return handleError(res, error, "Create criminal error");
    }
};

const getAllCriminals = async (req, res) => {
    try {
        const query = buildCriminalQueryFilters({
            search: req.query.search,
            status: req.query.status,
        });

        if (!query.valid) {
            return invalid(res, "Invalid criminal status", query.error);
        }

        const filter = query.filter;
        const page = Number.parseInt(req.query.page ?? "1", 10);
        const limit = Number.parseInt(req.query.limit ?? "10", 10);

        if (!Number.isInteger(page) || page < 1) {
            return invalid(res, "page must be a positive integer", "INVALID_PAGE");
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return invalid(
                res,
                "limit must be an integer between 1 and 100",
                "INVALID_LIMIT",
            );
        }

        const totalRecords = await Criminal.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const criminals = await Criminal.find(filter)
            .select("-__v")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        return res.status(200).json({
            success: true,
            count: criminals.length,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages,
            },
            data: criminals,
        });
    } catch (error) {
        return handleError(res, error, "Get criminals error");
    }
};

const getCriminalById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid criminal ID", "INVALID_CRIMINAL_ID");
        const criminal = await Criminal.findById(req.params.id).select("-__v");
        return criminal
            ? res.status(200).json({ success: true, data: criminal })
            : notFound(res, "Criminal");
    } catch (error) {
        return handleError(res, error, "Get criminal error");
    }
};

const updateCriminal = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid criminal ID", "INVALID_CRIMINAL_ID");

        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) =>
                allowedFields.includes(key),
            ),
        );

        if (!Object.keys(updates).length) {
            return invalid(res, "No valid criminal fields were provided");
        }

        const message = validateCriminal(updates, true);
        if (message) return invalid(res, message);

        const criminal = await Criminal.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true },
        ).select("-__v");

        return criminal
            ? res.status(200).json({
                  success: true,
                  message: "Criminal updated successfully",
                  data: criminal,
              })
            : notFound(res, "Criminal");
    } catch (error) {
        return handleError(res, error, "Update criminal error");
    }
};

const updateCriminalStatus = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid criminal ID", "INVALID_CRIMINAL_ID");

        const status = normalizeCriminalStatus(req.body?.status);
        if (status === null) {
            return invalid(
                res,
                "status must be one of: active, inactive, wanted, arrested, released, deceased",
                "INVALID_CRIMINAL_STATUS",
            );
        }

        const criminal = await Criminal.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true },
        ).select("-__v");

        return criminal
            ? res.status(200).json({
                  success: true,
                  message: "Criminal status updated successfully",
                  data: criminal,
              })
            : notFound(res, "Criminal");
    } catch (error) {
        return handleError(res, error, "Update criminal status error");
    }
};

const deleteCriminal = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid criminal ID", "INVALID_CRIMINAL_ID");

        const criminal = await Criminal.findByIdAndUpdate(
            req.params.id,
            { status: "inactive" },
            { new: true, runValidators: true },
        ).select("-__v");

        return criminal
            ? res.status(200).json({
                  success: true,
                  message: "Criminal record deactivated successfully",
                  data: criminal,
              })
            : notFound(res, "Criminal");
    } catch (error) {
        return handleError(res, error, "Deactivate criminal error");
    }
};

module.exports = {
    normalizeCriminalStatus,
    validateCriminalStatus,
    buildCriminalQueryFilters,
    validateCriminal,
    createCriminal,
    getAllCriminals,
    getCriminalById,
    updateCriminal,
    updateCriminalStatus,
    deleteCriminal,
};
