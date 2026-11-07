const PoliceStation = require("../models/PoliceStation");
const { isValidObjectId, invalid, notFound } = require("../controllers/controllerUtils");

const resolveActivePoliceStation = async (res, stationId, field) => {
    if (!isValidObjectId(stationId)) {
        invalid(res, `${field} must be a valid ObjectId`, `INVALID_${field.toUpperCase()}`);
        return null;
    }

    const station = await PoliceStation.findById(stationId).select("_id name isActive");
    if (!station) {
        notFound(res, "Police station");
        return null;
    }
    if (!station.isActive) {
        invalid(res, "Police station is inactive", "INACTIVE_POLICE_STATION");
        return null;
    }
    return station;
};

module.exports = { resolveActivePoliceStation };
