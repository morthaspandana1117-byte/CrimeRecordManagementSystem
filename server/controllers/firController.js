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
        Object.entries(body).filter(([key]) => allowedFields.includes(key)),
    );

const createFIR = async (req, res) => {
    try {
        const payload = strikeAllowedFields(req.body);
        const officerForUser = req.user?.role === "officer"
            ? await resolveOfficerForUser(req.user.userId)
            : null;

        if (req.user.role === "officer") {
            if (!officerForUser) {
                return res.status(403).json({
                    success: false,
                    message: "Officer is not eligible to register FIRs",
                    error: "OFFICER_INELIGIBLE",
                });
            }

            const officerEligibility = await ensureEligibleOfficer(req, res, officerForUser._id);
            if (!officerEligibility.valid) return officerEligibility.response;
            payload.registeredBy = officerForUser._id;
        } else if (req.user.role === "admin") {
            if (payload.registeredBy && payload.registeredBy !== "") {
                const adminOfficerCheck = await ensureEligibleOfficer(req, res, payload.registeredBy);
                if (!adminOfficerCheck.valid) return adminOfficerCheck.response;
            } else {
                payload.registeredBy = null;
            }
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
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid FIR ID", "INVALID_FIR_ID");
        }

        const updates = strikeAllowedFields(req.body);
        if (!Object.keys(updates).length) {
            return invalid(res, "No valid FIR fields were provided");
        }

        if (req.user.role === "officer") {
            const officer = await resolveOfficerForUser(req.user.userId);
            if (!officer) {
                return res.status(403).json({
                    success: false,
                    message: "Officer is not eligible to update FIRs",
                    error: "OFFICER_INELIGIBLE",
                });
            }
            if (updates.registeredBy && String(updates.registeredBy) !== String(officer._id)) {
                return res.status(403).json({
                    success: false,
                    message: "You can only update FIRs assigned to your officer profile",
                    error: "FORBIDDEN",
                });
            }
            updates.registeredBy = officer._id;
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

module.exports = {
    createFIR,
    getAllFIRs,
    getFIRById,
    updateFIR,
    updateFIRStatus,
    normalizeFIRStatus,
    validateFIRStatus,
    buildFIRQueryFilters,
    validateFIR,
};
