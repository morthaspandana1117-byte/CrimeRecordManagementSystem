const PoliceStation = require("../models/PoliceStation");
const { isNonEmptyString, invalid, notFound, handleError } = require("./controllerUtils");

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

const createPoliceStation = async (req, res) => {
    try {
        const { name, code, state } = req.body || {};
        if (!isNonEmptyString(name) || !isNonEmptyString(code)) {
            return invalid(res, "Station name and code are required", "MISSING_STATION_FIELDS");
        }
        for (const [field, value] of Object.entries({ state })) {
            if (value !== undefined && !isNonEmptyString(value)) {
                return invalid(res, `${field} must not be empty`, "INVALID_STATION_FIELD");
            }
        }

        const station = await PoliceStation.create({
            name,
            code,
            ...(state !== undefined ? { state } : {}),
        });
        return res.status(201).json({
            success: true,
            message: "Police station created successfully",
            data: stationDto(station),
        });
    } catch (error) {
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

module.exports = {
    listActivePoliceStations,
    createPoliceStation,
    updatePoliceStationStatus,
};
