const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const PoliceStation = require("../models/PoliceStation");
const { resolveActivePoliceStation } = require("../services/policeStationService");
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
const {
    canAccessAssignedRecord,
    isSeniorOfficerRank,
} = require("../middleware/authority");

const validStatuses = [
    "Open",
    "Registered",
    "Under Investigation",
    "Charge Sheet Filed",
    "Closed",
];

const allowedFields = [
    "firNo",
    "date",
    "policeStation",
    "policeStationId",
    "complaint",
    "description",
    "crimeType",
    "location",
    "latitude",
    "longitude",
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
    "criminalIds",
    "status",
];

const populate = (query) =>
    query
        .populate(
            "registeredBy",
            "officerId name rank department station status userId",
        )
        .populate("criminalIds", "criminalId fullName status");

const normalizeFIRStatus = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.toLowerCase();
    const aliases = {
        open: "Open",
        registered: "Open",
        "under investigation": "Under Investigation",
        "charge sheet filed": "Charge Sheet Filed",
        closed: "Closed",
    };

    if (aliases[normalized]) return aliases[normalized];
    return validStatuses.includes(trimmed) ? trimmed : null;
};

const validateFIRStatus = (value) => normalizeFIRStatus(value) !== null;

const canAccessFIR = (req, fir) =>
    canAccessAssignedRecord(req.authority, [fir?.registeredBy]);

const getAssignedStationForOfficer = async (res, officer) => {
    if (!officer?.stationId) {
        res.status(403).json({
            success: false,
            message: "An administrator must assign your police station before FIR operations",
            error: "STATION_ASSIGNMENT_REQUIRED",
        });
        return null;
    }

    const station = await PoliceStation.findOne({
        _id: officer.stationId,
        isActive: true,
    }).select("_id name");
    if (!station) {
        res.status(403).json({
            success: false,
            message: "Your assigned police station is unavailable or inactive",
            error: "STATION_ASSIGNMENT_INVALID",
        });
        return null;
    }
    return station;
};

const resolveFIRStation = async (res, stationId) => {
    if (!stationId) {
        invalid(res, "policeStationId is required", "POLICE_STATION_REFERENCE_REQUIRED");
        return null;
    }
    return resolveActivePoliceStation(res, stationId, "policeStationId");
};

const buildFIRQueryFilters = ({ search, status, crimeType } = {}) => {
    const filter = {};

    if (status !== undefined) {
        const normalizedStatus = normalizeFIRStatus(status);
        if (normalizedStatus === null) {
            return {
                valid: false,
                error: "INVALID_FIR_STATUS",
            };
        }
        filter.status = normalizedStatus;
    }

    if (crimeType !== undefined && crimeType !== "") {
        const trimmedCrimeType = String(crimeType).trim();
        if (!trimmedCrimeType) {
            return {
                valid: false,
                error: "INVALID_CRIME_TYPE",
            };
        }
        filter.crimeType = trimmedCrimeType;
    }

    const searchTerm = typeof search === "string" ? search.trim() : "";
    if (searchTerm) {
        filter.$or = [
            { firNo: { $regex: searchTerm, $options: "i" } },
            { policeStation: { $regex: searchTerm, $options: "i" } },
            { description: { $regex: searchTerm, $options: "i" } },
            { crimeType: { $regex: searchTerm, $options: "i" } },
            { "complaint.complainantName": { $regex: searchTerm, $options: "i" } },
            { "complaint.complaintText": { $regex: searchTerm, $options: "i" } },
            { "location.city": { $regex: searchTerm, $options: "i" } },
        ];
    }

    return { valid: true, filter };
};

const resolveOfficerForUser = async (userId) => {
    if (!userId) return null;
    const officer = await Officer.findOne({ userId });
    if (!officer) return null;
    if (typeof officer.populate === "function") {
        return officer.populate("userId", "status isActive role");
    }
    return officer;
};

const ensureEligibleOfficer = async (req, res, officerId) => {
    const officerRecord = await Officer.findById(officerId);
    const officer =
        officerRecord && typeof officerRecord.populate === "function"
            ? await officerRecord.populate("userId", "status isActive role")
            : officerRecord;

    if (!officer) {
        return { valid: false, response: notFound(res, "Officer") };
    }

    if (officer.status !== "active") {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer is not eligible to register FIRs",
                error: "OFFICER_INELIGIBLE",
            }),
        };
    }

    if (!officer.userId || officer.userId.isActive === false) {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer account is inactive",
                error: "OFFICER_INACTIVE",
            }),
        };
    }

    if (officer.userId.role === "officer" && (officer.userId.status || "approved") !== "approved") {
        return {
            valid: false,
            response: res.status(403).json({
                success: false,
                message: "Officer account is not approved",
                error: "OFFICER_NOT_APPROVED",
            }),
        };
    }

    return { valid: true, officer };
};

const validateFIR = async (res, body, partial = false, req = null) => {
    if (
        !partial &&
        required.some(
            (field) =>
                body[field] === undefined ||
                body[field] === null ||
                (typeof body[field] === "string" && body[field].trim() === ""),
        )
    ) {
        return "All required FIR fields must be provided";
    }

    if ((!partial || body.firNo !== undefined) && !isNonEmptyString(body.firNo)) {
        return "firNo must be a valid FIR number";
    }

    if ((!partial || body.date !== undefined) && !isValidDate(body.date)) {
        return "date must be a valid date";
    }

    if (
        (!partial || body.policeStation !== undefined) &&
        !isNonEmptyString(body.policeStation)
    ) {
        return "policeStation is required";
    }

    if (
        (!partial || body.complaint !== undefined) &&
        (!body.complaint ||
            !isNonEmptyString(body.complaint.complainantName) ||
            !isNonEmptyString(body.complaint.complaintText))
    ) {
        return "complaint name and text are required";
    }

    if ((!partial || body.description !== undefined) && !isNonEmptyString(body.description)) {
        return "description must not be empty";
    }

    if (
        (!partial || body.crimeType !== undefined) &&
        !isNonEmptyString(body.crimeType)
    ) {
        return "crimeType is required";
    }

    if (
        (!partial || body.location !== undefined) &&
        (!body.location ||
            ["address", "city", "state", "pincode"].some(
                (field) => !isNonEmptyString(body.location[field]),
            ))
    ) {
        return "location address, city, state, and pincode are required";
    }

    const hasLatitude = Object.prototype.hasOwnProperty.call(body, "latitude");
    const hasLongitude = Object.prototype.hasOwnProperty.call(body, "longitude");
    if (hasLatitude !== hasLongitude) {
        return "latitude and longitude must be provided together";
    }
    if (hasLatitude && hasLongitude) {
        const latitudeEmpty = body.latitude === null || body.latitude === "";
        const longitudeEmpty = body.longitude === null || body.longitude === "";
        if (latitudeEmpty !== longitudeEmpty) {
            return "latitude and longitude must both contain verified coordinates or both be empty";
        }
        if (latitudeEmpty) {
            body.latitude = null;
            body.longitude = null;
        } else {
            const parseCoordinate = (value) => {
                if (typeof value === "number") return value;
                if (typeof value !== "string" || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
                    return Number.NaN;
                }
                return Number(value);
            };
            const latitude = parseCoordinate(body.latitude);
            const longitude = parseCoordinate(body.longitude);
            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
                return "latitude must be a number between -90 and 90";
            }
            if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
                return "longitude must be a number between -180 and 180";
            }
            body.latitude = latitude;
            body.longitude = longitude;
        }
    }

    if (body.status !== undefined) {
        const normalizedStatus = normalizeFIRStatus(body.status);
        if (normalizedStatus === null) {
            return "status must be one of: Open, Under Investigation, Closed";
        }
        body.status = normalizedStatus;
    }

    if (body.registeredBy !== undefined) {
        const validReference = await validateReference(
            res,
            Officer,
            body.registeredBy,
            "registeredBy",
        );
        if (!validReference) return null;
        if (req) {
            const officerCheck = await ensureEligibleOfficer(req, res, body.registeredBy);
            if (!officerCheck.valid) return null;
        }
    }

    if (body.criminalIds !== undefined) {
        if (!Array.isArray(body.criminalIds) || body.criminalIds.length === 0) {
            return "criminalIds must be a non-empty array";
        }

        if (new Set(body.criminalIds.map((value) => String(value))).size !== body.criminalIds.length) {
            return "criminalIds contains duplicate values";
        }

        if (body.criminalIds.some((value) => !isValidObjectId(value))) {
            return "criminalIds contains an invalid ObjectId";
        }

        if (!(await validateReferences(res, Criminal, body.criminalIds, "criminalIds"))) {
            return null;
        }
    }

    return "OK";
};

const strikeAllowedFields = (body) =>
    Object.fromEntries(
        Object.entries(body || {}).filter(([key]) => allowedFields.includes(key)),
    );

const createFIR = async (req, res) => {
    try {
        const systemRole = req.authority?.systemRole || req.user?.systemRole || (req.user?.role === "admin" ? "system_admin" : req.user?.role);
        const payload = strikeAllowedFields(req.body);
        const officerForUser = systemRole === "officer"
            ? await resolveOfficerForUser(req.user.userId)
            : null;

        if (systemRole === "officer") {
            if (!officerForUser) {
                return res.status(403).json({
                    success: false,
                    message: "Officer is not eligible to register FIRs",
                    error: "OFFICER_INELIGIBLE",
                });
            }

            const officerEligibility = await ensureEligibleOfficer(req, res, officerForUser._id);
            if (!officerEligibility.valid) return officerEligibility.response;
            const assignedStation = await getAssignedStationForOfficer(res, officerForUser);
            if (!assignedStation) return;
            const selectedStation = await resolveFIRStation(res, payload.policeStationId);
            if (!selectedStation) return;
            if (String(selectedStation._id) !== String(assignedStation._id)) {
                return res.status(403).json({
                    success: false,
                    message: "You may only create FIRs for your assigned police station",
                    error: "POLICE_STATION_ASSIGNMENT_DENIED",
                });
            }
            payload.policeStationId = assignedStation._id;
            payload.policeStation = assignedStation.name;
            payload.registeredBy = officerForUser._id;
        } else if (systemRole === "system_admin") {
            if (payload.registeredBy && payload.registeredBy !== "") {
                const adminOfficerCheck = await ensureEligibleOfficer(req, res, payload.registeredBy);
                if (!adminOfficerCheck.valid) return adminOfficerCheck.response;
            } else {
                payload.registeredBy = null;
            }
        }

        if (systemRole !== "officer") {
            return res.status(403).json({
                success: false,
                message: "Only an authenticated officer can create an FIR",
                error: "FIR_CREATION_DENIED",
            });
        }

        if (!payload.registeredBy) {
            return invalid(res, "registeredBy is required", "INVALID_REGISTERED_BY");
        }

        if (!payload.status) {
            payload.status = "Open";
        }

        const result = await validateFIR(res, payload, false, req);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        const fir = await FIR.create(payload);
        const createdFIR = await populate(FIR.findById(fir._id).select("-__v"));

        return res.status(201).json({
            success: true,
            message: "FIR created successfully",
            data: createdFIR,
        });
    } catch (error) {
        return handleError(res, error, "Create FIR error");
    }
};

const getAllFIRs = async (req, res) => {
    try {
        const query = buildFIRQueryFilters({
            search: req.query.search,
            status: req.query.status,
            crimeType: req.query.crimeType,
        });

        if (!query.valid) {
            return invalid(res, "Invalid FIR filter", query.error);
        }

        const filter = query.filter;
        if (!isSeniorOfficerRank(req.authority?.rank) &&
            req.authority?.systemRole !== "system_admin") {
            filter.registeredBy = req.authority.officer._id;
        }
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

        const totalRecords = await FIR.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const firs = await populate(
            FIR.find(filter)
                .select("-__v")
                .sort({ date: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
        );

        return res.status(200).json({
            success: true,
            count: firs.length,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages,
            },
            data: firs,
        });
    } catch (error) {
        return handleError(res, error, "Get FIRs error");
    }
};

const getFIRById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        }

        const rawFIR = await FIR.findById(req.params.id).select("-__v");
        if (rawFIR && !canAccessFIR(req, rawFIR)) {
            return res.status(403).json({ success: false, message: "You may only access relevant FIRs", error: "FIR_ACCESS_DENIED" });
        }
        const fir = await populate(rawFIR ? FIR.findById(req.params.id).select("-__v") : FIR.findById(req.params.id));
        return fir
            ? res.status(200).json({ success: true, data: fir })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Get FIR error");
    }
};

const updateFIR = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        }

        const updates = strikeAllowedFields(req.body);
        if (!Object.keys(updates).length) {
            return invalid(res, "No valid FIR fields were provided");
        }

        const existingFIR = await FIR.findById(req.params.id).select("registeredBy policeStation policeStationId");
        if (!existingFIR) return notFound(res, "FIR");
        if (!canAccessFIR(req, existingFIR)) {
            return res.status(403).json({ success: false, message: "You may only update relevant FIRs", error: "FIR_ACCESS_DENIED" });
        }

        const systemRole = req.authority?.systemRole || req.user?.systemRole || (req.user?.role === "admin" ? "system_admin" : req.user?.role);
        let officer = null;
        if (systemRole === "officer") {
            officer = await resolveOfficerForUser(req.user.userId);
            if (!officer) {
                return res.status(403).json({
                    success: false,
                    message: "Officer is not eligible to update FIRs",
                    error: "OFFICER_INELIGIBLE",
                });
            }
        }

        if (systemRole === "officer") {
            const requestedStationId = updates.policeStationId;
            const existingStationId = existingFIR.policeStationId;
            const stationIdChanged = requestedStationId !== undefined &&
                String(requestedStationId || "") !== String(existingStationId || "");
            const stationNameChanged = updates.policeStation !== undefined &&
                updates.policeStation !== existingFIR.policeStation;

            if (stationIdChanged || stationNameChanged) {
                return res.status(403).json({
                    success: false,
                    message: "The police station assigned to an FIR cannot be changed",
                    error: "POLICE_STATION_ASSIGNMENT_DENIED",
                });
            }

            delete updates.policeStationId;
            delete updates.policeStation;
        } else if (updates.policeStationId !== undefined) {
            const selectedStation = await resolveFIRStation(res, updates.policeStationId);
            if (!selectedStation) return;
            updates.policeStationId = selectedStation._id;
            updates.policeStation = selectedStation.name;
        } else if (updates.policeStation !== undefined && existingFIR.policeStationId) {
            return invalid(
                res,
                "A linked police station can only be changed using policeStationId",
                "POLICE_STATION_REFERENCE_REQUIRED",
            );
        }
        if (systemRole === "officer") {
            // Editing never transfers ownership: the registering officer is kept.
            if (updates.registeredBy && String(updates.registeredBy) !== String(existingFIR.registeredBy)) {
                return res.status(403).json({
                    success: false,
                    message: "FIR ownership cannot be changed through an update",
                    error: "FORBIDDEN",
                });
            }
            delete updates.registeredBy;
        }

        const result = await validateFIR(res, updates, true, req);
        if (result !== "OK") return result ? invalid(res, result) : undefined;

        const fir = await populate(
            FIR.findByIdAndUpdate(req.params.id, updates, {
                new: true,
                runValidators: true,
            }).select("-__v"),
        );

        return fir
            ? res.status(200).json({
                  success: true,
                  message: "FIR updated successfully",
                  data: fir,
              })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Update FIR error");
    }
};

const updateFIRStatus = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        }

        const normalizedStatus = normalizeFIRStatus(req.body.status);
        if (normalizedStatus === null) {
            return invalid(
                res,
                "status must be one of: Open, Under Investigation, Closed",
                "INVALID_FIR_STATUS",
            );
        }

        const existingFIR = await FIR.findById(req.params.id).select("registeredBy");
        if (!existingFIR) return notFound(res, "FIR");
        if (!canAccessFIR(req, existingFIR)) {
            return res.status(403).json({ success: false, message: "You may only update relevant FIRs", error: "FIR_ACCESS_DENIED" });
        }

        const fir = await populate(
            FIR.findByIdAndUpdate(
                req.params.id,
                { status: normalizedStatus },
                { new: true, runValidators: true },
            ).select("-__v"),
        );

        return fir
            ? res.status(200).json({
                  success: true,
                  message: "FIR status updated successfully",
                  data: fir,
              })
            : notFound(res, "FIR");
    } catch (error) {
        return handleError(res, error, "Update FIR status error");
    }
};

const mapCrimeTypes = [
    "Theft", "Robbery", "Murder", "Assault", "Kidnapping", "Fraud",
    "Cyber Crime", "Drug Offense", "Sexual Offense", "Property Crime", "Other",
];
const mapCaseStatuses = ["Open", "Under Investigation", "Court Proceedings", "Closed", "Reopened"];
const mapFilterKeys = new Set(["crimeType", "caseStatus", "fromDate", "toDate"]);
const isScalarQueryValue = (value) => typeof value === "string" && value.trim().length > 0;
const parseMapDate = (value) => {
    if (!isScalarQueryValue(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const getFIRMapData = async (req, res) => {
    try {
        if (
            req.authority?.systemRole !== "officer" ||
            req.authority?.user?.status !== "approved"
        ) {
            return res.status(403).json({
                success: false,
                message: "An approved officer account is required to view station crime markers",
                error: "OFFICER_NOT_APPROVED",
            });
        }

        const officer = await Officer.findById(req.authority.officer?._id)
            .select("stationId status")
            .lean();
        if (!officer || officer.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "An active officer account is required to view station crime markers",
                error: "OFFICER_INELIGIBLE",
            });
        }
        if (!isValidObjectId(officer.stationId)) {
            return res.status(403).json({
                success: false,
                message: "A valid assigned police station is required to view crime markers",
                error: "STATION_ASSIGNMENT_REQUIRED",
            });
        }
        const activeStation = await PoliceStation.findOne({
            _id: officer.stationId,
            isActive: true,
        }).select("_id").lean();
        if (!activeStation) {
            return res.status(403).json({
                success: false,
                message: "The assigned police station is invalid or inactive",
                error: "STATION_ASSIGNMENT_INVALID",
            });
        }

        const query = req.query || {};
        if (
            Object.keys(query).some((key) => !mapFilterKeys.has(key)) ||
            Object.values(query).some((value) => !isScalarQueryValue(value))
        ) {
            return invalid(res, "Unsupported or malformed map filter", "INVALID_MAP_FILTER");
        }

        const fromDate = query.fromDate === undefined ? null : parseMapDate(query.fromDate);
        const toDate = query.toDate === undefined ? null : parseMapDate(query.toDate);
        if (query.fromDate !== undefined && !fromDate) {
            return invalid(res, "fromDate must be a valid ISO date", "INVALID_FROM_DATE");
        }
        if (query.toDate !== undefined && !toDate) {
            return invalid(res, "toDate must be a valid ISO date", "INVALID_TO_DATE");
        }
        if (fromDate && toDate && fromDate > toDate) {
            return invalid(res, "fromDate must be on or before toDate", "INVALID_DATE_RANGE");
        }

        const filter = { policeStationId: activeStation._id };
        if (query.crimeType !== undefined) {
            if (!mapCrimeTypes.includes(query.crimeType)) {
                return invalid(res, "Unsupported crimeType", "INVALID_CRIME_TYPE");
            }
            filter.crimeType = query.crimeType;
        }
        if (fromDate || toDate) {
            filter.date = {};
            if (fromDate) filter.date.$gte = fromDate;
            if (toDate) {
                const exclusiveEnd = new Date(toDate);
                exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
                filter.date.$lt = exclusiveEnd;
            }
        }
        const caseMatch = query.caseStatus === undefined ? null : query.caseStatus;
        if (caseMatch && !mapCaseStatuses.includes(caseMatch)) {
            return invalid(res, "Unsupported caseStatus", "INVALID_CASE_STATUS");
        }

        const mappedCoordinates = {
            $and: [
                { $isNumber: "$latitude" },
                { $isNumber: "$longitude" },
                { $gte: ["$latitude", -90] },
                { $lte: ["$latitude", 90] },
                { $gte: ["$longitude", -180] },
                { $lte: ["$longitude", 180] },
            ],
        };
        const [result] = await FIR.aggregate([
            { $match: filter },
            {
                $lookup: {
                    from: Case.collection.name,
                    let: { firId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$firId", "$$firId"] } } },
                        { $project: { caseNo: 1, status: 1 } },
                        { $limit: 1 },
                        { $limit: 1 },
                    ],
                    as: "caseRecord",
                },
            },
            { $unwind: { path: "$caseRecord", preserveNullAndEmptyArrays: true } },
            ...(caseMatch ? [{ $match: { "caseRecord.status": caseMatch } }] : []),
            {
                $facet: {
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalRecords: { $sum: 1 },
                                mappedRecords: { $sum: { $cond: [mappedCoordinates, 1, 0] } },
                            },
                        },
                    ],
                    records: [
                        { $match: { $expr: mappedCoordinates } },
                        {
                            $project: {
                                _id: 1,
                                firNo: 1,
                                date: 1,
                                crimeType: 1,
                                status: 1,
                                latitude: 1,
                                longitude: 1,
                                "location.city": 1,
                                "location.state": 1,
                                policeStation: 1,
                                caseNo: "$caseRecord.caseNo",
                                caseStatus: "$caseRecord.status",
                            },
                        },
                        { $sort: { date: -1, _id: 1 } },
                    ],
                },
            },
        ]);
        const summary = result?.summary?.[0] || { totalRecords: 0, mappedRecords: 0 };
        return res.status(200).json({
            success: true,
            data: {
                totalRecords: summary.totalRecords,
                mappedRecords: summary.mappedRecords,
                unmappedRecords: summary.totalRecords - summary.mappedRecords,
                records: result?.records || [],
            },
        });
    } catch (error) {
        return handleError(res, error, "Get FIR map data error");
    }
};

module.exports = {
    createFIR,
    getAllFIRs,
    getFIRById,
    getFIRMapData,
    updateFIR,
    updateFIRStatus,
    normalizeFIRStatus,
    validateFIRStatus,
    buildFIRQueryFilters,
    validateFIR,
};
