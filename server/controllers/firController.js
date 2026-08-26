const FIR = require("../models/FIR");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const {
    isValidObjectId,
    isNonEmptyString,
    isValidDate,
    invalid,
    notFound,
    validateReference,
    validateReferences,
    handleError,
} = require("./controllerUtils");

const allowedFields = [
    "firNo",
    "date",
    "policeStation",
    "complaint",
    "description",
    "crimeType",
    "location",
    "registeredBy",
    "criminalIds",
    "status",
];
const required = [
    "firNo",
    "date",
    "policeStation",
    "complaint",
    "description",
    "crimeType",
    "location",
    "registeredBy",
    "criminalIds",
    "status",
];
const populate = (query) =>
    query
        .populate(
            "registeredBy",
            "officerId name rank department station status",
        )
        .populate("criminalIds", "criminalId fullName status");

const validateFIR = async (res, body, partial = false) => {
    if (
        !partial &&
        required.some(
            (field) =>
                body[field] === undefined ||
                body[field] === null ||
                body[field] === "",
        )
    )
        return "All required FIR fields must be provided";
    if ((!partial || body.date !== undefined) && !isValidDate(body.date))
        return "date must be a valid date";
    if (
        (!partial || body.complaint !== undefined) &&
        (!body.complaint ||
            !isNonEmptyString(body.complaint.complainantName) ||
            !isNonEmptyString(body.complaint.complaintText))
    )
        return "complaint name and text are required";
    if (
        (!partial || body.location !== undefined) &&
        (!body.location ||
            ["address", "city", "state", "pincode"].some(
                (field) => !isNonEmptyString(body.location[field]),
            ))
    )
        return "location address, city, state, and pincode are required";
    if (
        body.registeredBy !== undefined &&
        !(await validateReference(
            res,
            Officer,
            body.registeredBy,
            "registeredBy",
        ))
    )
        return null;
    if (
        body.criminalIds !== undefined &&
        !(await validateReferences(
            res,
            Criminal,
            body.criminalIds,
            "criminalIds",
        ))
    )
        return null;
    return "OK";
};

const createFIR = async (req, res) => {
    try {
        const result = await validateFIR(res, req.body);
        if (result !== "OK") return result ? invalid(res, result) : undefined;
        const fir = await FIR.create(req.body);
        await populate(
            fir
                .populate(
                    "registeredBy",
                    "officerId name rank department station status",
                )
                .populate("criminalIds", "criminalId fullName status"),
        );
        return res
            .status(201)
            .json({
                success: true,
                message: "FIR created successfully",
                data: fir,
            });
    } catch (error) {
        return handleError(res, error, "Create FIR error");
    }
};

const getAllFIRs = async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.crimeType) filter.crimeType = req.query.crimeType;
        if (req.query.search)
            filter.$or = ["firNo", "policeStation", "description"].map(
                (field) => ({
                    [field]: { $regex: req.query.search, $options: "i" },
                }),
            );
        const firs = await populate(
            FIR.find(filter).select("-__v").sort({ date: -1 }),
        );
        return res
            .status(200)
            .json({ success: true, count: firs.length, data: firs });
    } catch (error) {
        return handleError(res, error, "Get FIRs error");
    }
};

const getFIRById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        const fir = await populate(FIR.findById(req.params.id).select("-__v"));
        return fir
            ? res.status(200).json({ success: true, data: fir })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Get FIR error");
    }
};

const updateFIR = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        const updates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) =>
                allowedFields.includes(key),
            ),
        );
        if (!Object.keys(updates).length)
            return invalid(res, "No valid FIR fields were provided");
        const result = await validateFIR(res, updates, true);
        if (result !== "OK") return result ? invalid(res, result) : undefined;
        const fir = await populate(
            FIR.findByIdAndUpdate(req.params.id, updates, {
                new: true,
                runValidators: true,
            }).select("-__v"),
        );
        return fir
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "FIR updated successfully",
                      data: fir,
                  })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Update FIR error");
    }
};

const deleteFIR = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id))
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        const fir = await populate(
            FIR.findByIdAndUpdate(
                req.params.id,
                { status: "Closed" },
                { new: true, runValidators: true },
            ).select("-__v"),
        );
        return fir
            ? res
                  .status(200)
                  .json({
                      success: true,
                      message: "FIR closed successfully",
                      data: fir,
                  })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Close FIR error");
    }
};

module.exports = { createFIR, getAllFIRs, getFIRById, updateFIR, deleteFIR };
