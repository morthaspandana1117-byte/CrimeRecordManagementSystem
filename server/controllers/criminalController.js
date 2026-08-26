const Criminal = require("../models/Criminal");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    handleError,
} = require("./controllerUtils");

const required = [
    "criminalId",
    "fullName",
    "dateOfBirth",
    "gender",
    "address",
    "status",
];
const allowedFields = [
    "criminalId",
    "fullName",
    "dateOfBirth",
    "gender",
    "address",
    "phoneNumber",
    "identificationDetails",
    "photo",
    "status",
];

const validateCriminal = (body, partial = false) => {
    if (
        !partial &&
        required.some(
            (field) =>
                !isNonEmptyString(body[field]) && field !== "dateOfBirth",
        )
    )
        return "All required criminal fields must be provided";
    if (
        (!partial || body.dateOfBirth !== undefined) &&
        !isValidDate(body.dateOfBirth)
    )
        return "dateOfBirth must be a valid date";
    return null;
};

const createCriminal = async (req, res) => {
    try {
        const message = validateCriminal(req.body);
        if (message) return invalid(res, message);
        const criminal = await Criminal.create(req.body);
        return res
            .status(201)
            .json({
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
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.search)
            filter.$or = ["criminalId", "fullName", "phoneNumber"].map(
                (field) => ({
                    [field]: { $regex: req.query.search, $options: "i" },
                }),
            );
        const criminals = await Criminal.find(filter)
            .select("-__v")
            .sort({ createdAt: -1 });
        return res
            .status(200)
            .json({ success: true, count: criminals.length, data: criminals });
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
        if (!Object.keys(updates).length)
            return invalid(res, "No valid criminal fields were provided");
        const message = validateCriminal(updates, true);
        if (message) return invalid(res, message);
        const criminal = await Criminal.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true },
        ).select("-__v");
        return criminal
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "Criminal updated successfully",
                      data: criminal,
                  })
            : notFound(res, "Criminal");
    } catch (error) {
        return handleError(res, error, "Update criminal error");
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
            ? res
                  .status(200)
                  .json({
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
    createCriminal,
    getAllCriminals,
    getCriminalById,
    updateCriminal,
    deleteCriminal,
};
