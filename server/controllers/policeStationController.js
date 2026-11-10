const PoliceStation = require("../models/PoliceStation");
const { isValidObjectId, isNonEmptyString, invalid, notFound, conflict, handleError } = require("./controllerUtils");

const stationDto = (station) => ({
    _id: station._id,
    name: station.name,
    code: station.code,
    ...(station.state ? { state: station.state } : {}),
    isActive: station.isActive,
    createdAt: station.createdAt,
    updatedAt: station.updatedAt,
});

const listActivePoliceStations = async (req, res) => {
    try {
        const stations = await PoliceStation.find({ isActive: true })
            .select("_id name")
            .sort({ name: 1 })
            .lean();
        return res.status(200).json({ success: true, count: stations.length, data: stations });
    } catch (error) {
        return handleError(res, error, "List police stations error");
    }
};

const listPoliceStations = async (req, res) => {
    try {
        const stations = await PoliceStation.find().sort({ name: 1 }).lean();
        return res.status(200).json({ success: true, count: stations.length, data: stations.map(stationDto) });
    } catch (error) {
        return handleError(res, error, "List police stations error");
    }
};

const createPoliceStation = async (req, res) => {
    try {
        const { name, code, state } = req.body || {};
        const normalizedName = typeof name === "string" ? name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
        const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";

        if (!isNonEmptyString(normalizedName) || !isNonEmptyString(normalizedCode)) {
            return invalid(res, "Station name and code are required", "MISSING_STATION_FIELDS");
        }
        if (state !== undefined && typeof state !== "string") {
            return invalid(res, "state must be a string", "INVALID_STATION_FIELD");
        }

        const station = await PoliceStation.create({
            name: normalizedName,
            code: normalizedCode,
            ...(state?.trim() ? { state: state.trim() } : {}),
        });
        return res.status(201).json({
            success: true,
            message: "Police station created successfully",
            data: stationDto(station),
        });
    } catch (error) {
        if (error?.code === 11000) {
            const duplicateField = Object.keys(error.keyPattern || {})[0];
            if (duplicateField === "normalizedName") {
                return conflict(res, "A police station with that name already exists", "DUPLICATE_STATION_NAME");
            }
            if (duplicateField === "code") {
                return conflict(res, "A police station with that code already exists", "DUPLICATE_STATION_CODE");
            }
        }
        return handleError(res, error, "Create police station error");
    }
};

const updatePoliceStationStatus = async (req, res) => {
    try {
        if (!["true", "false"].includes(String(req.body?.isActive))) {
            return invalid(res, "isActive must be a boolean", "INVALID_STATION_STATUS");
        }
        const station = await PoliceStation.findByIdAndUpdate(
            req.params.id,
            { isActive: req.body.isActive },
            { new: true, runValidators: true },
        );
        if (!station) return notFound(res, "Police station");
        return res.status(200).json({
            success: true,
            message: "Police station status updated",
            data: stationDto(station),
        });
    } catch (error) {
        return handleError(res, error, "Update police station status error");
    }
};

const updatePoliceStation = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid police station ID", "INVALID_STATION_ID");
        const body = req.body || {};
        const allowedFields = new Set(["name", "code", "state"]);
        if (Object.keys(body).some((field) => !allowedFields.has(field))) {
            return invalid(res, "Only name, code, and state can be edited here", "INVALID_STATION_FIELDS");
        }
        if (!Object.keys(body).length) return invalid(res, "Provide at least one station field to update", "NO_UPDATE_FIELDS");
        for (const field of ["name", "code"]) {
            if (body[field] !== undefined && !isNonEmptyString(body[field])) {
                return invalid(res, `${field} must not be empty`, "INVALID_STATION_FIELD");
            }
        }
        if (body.state !== undefined && typeof body.state !== "string") {
            return invalid(res, "state must be a string", "INVALID_STATION_FIELD");
        }

        const station = await PoliceStation.findById(req.params.id);
        if (!station) return notFound(res, "Police station");
        if (body.name !== undefined) station.name = body.name;
        if (body.code !== undefined) station.code = body.code;
        if (body.state !== undefined) station.state = body.state.trim() || undefined;
        await station.save();
        return res.status(200).json({
            success: true,
            message: "Police station updated successfully",
            data: stationDto(station),
        });
    } catch (error) {
        return handleError(res, error, "Update police station error");
    }
};

module.exports = {
    listActivePoliceStations,
    listPoliceStations,
    createPoliceStation,
    updatePoliceStation,
    updatePoliceStationStatus,
};
