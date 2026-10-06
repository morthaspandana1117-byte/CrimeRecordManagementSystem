const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Officer = require("../models/Officer");
const auditService = require("../services/auditService");
const {
    normalizeOfficerManagementRank,
    canManageOfficerRank,
} = require("../middleware/authority");

const {
    isValidObjectId,
    isValidDate,
    isNonEmptyString,
    isValidBatchNumber,
    invalid,
    notFound,
    handleError,
} = require("./controllerUtils");

const officerFields = [
    "officerId",
    "badgeNumber",
    "name",
    "rank",
    "department",
    "station",
    "phoneNumber",
    "address",
    "joiningDate",
];

const isManageableSubordinate = (req, officer) =>
    req.authority?.systemRole === "officer" &&
    String(req.authority?.officer?._id) !== String(officer?._id) &&
    officer?.userId?.role === "officer" &&
    canManageOfficerRank(req.authority?.managementRank, officer?.rank);

const normalizeOfficerSearchValue = (value) => {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().toLowerCase();
};

const normalizeApprovalStatus = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

    return ["pending", "approved", "rejected"].includes(normalized) ? normalized : null;
};

const normalizeAccountStatus = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

    return ["active", "inactive"].includes(normalized) ? normalized : null;
};

const validateOfficerAccountStatus = (value) => normalizeAccountStatus(value) !== null;

const buildOfficerFilters = ({ search, approvalStatus, accountStatus } = {}) => {
    const filters = {};
    const normalizedSearch = normalizeOfficerSearchValue(search);

    if (normalizedSearch) {
        filters.search = normalizedSearch;
        filters.searchRegex = new RegExp(normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }

    const normalizedApprovalStatus = normalizeApprovalStatus(approvalStatus);
    if (normalizedApprovalStatus) {
        filters.approvalStatus = normalizedApprovalStatus;
    }

    const normalizedAccountStatus = normalizeAccountStatus(accountStatus);
    if (normalizedAccountStatus) {
        filters.accountStatus = normalizedAccountStatus;
    }

    return filters;
};

const validateOfficerQueryFilters = (query = {}) => {
    const invalidApprovalStatus = query.approvalStatus && !normalizeApprovalStatus(query.approvalStatus);
    const invalidAccountStatus = query.accountStatus && !normalizeAccountStatus(query.accountStatus);

    if (invalidApprovalStatus || invalidAccountStatus) {
        return {
            valid: false,
            message: invalidApprovalStatus
                ? "approvalStatus must be one of: pending, approved, rejected"
                : "accountStatus must be one of: active, inactive",
            error: invalidApprovalStatus ? "INVALID_APPROVAL_STATUS" : "INVALID_ACCOUNT_STATUS",
        };
    }

    return {
        valid: true,
        filters: buildOfficerFilters(query),
    };
};

const buildOfficerSearchMatch = (officer, searchRegex) => {
    if (!searchRegex) {
        return true;
    }

    const userName = officer.userId?.username || "";
    return [
        officer.name,
        officer.officerId,
        officer.badgeNumber,
        userName,
    ].some((field) => field && searchRegex.test(String(field)));
};

const registerOfficer = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const {
            username,
            email,
            officerId,
            name,
            rank,
            department,
            station,
            phoneNumber,
            address,
            joiningDate,
        } = req.body;

        const batchNumber =
            typeof req.body.batchNumber === "string"
                ? req.body.batchNumber.trim()
                : typeof req.body.badgeNumber === "string"
                    ? req.body.badgeNumber.trim()
                    : "";

        if (
            !username ||
            !email ||
            !batchNumber ||
            !officerId ||
            !name ||
            !rank ||
            !department ||
            !station ||
            !phoneNumber ||
            !address ||
            !joiningDate
        ) {
            return res.status(400).json({
                success: false,
                message: "All required officer fields must be provided",
                error: "MISSING_REQUIRED_FIELDS",
            });
        }

        const requiredStrings = {
            username,
            email,
            officerId,
            badgeNumber: batchNumber,
            name,
            rank,
            department,
            station,
            phoneNumber,
            address,
        };

        for (const [field, value] of Object.entries(requiredStrings)) {
            if (!isNonEmptyString(value)) {
                return invalid(
                    res,
                    `${field} must not be empty`,
                    "INVALID_FIELD"
                );
            }
        }

        const normalizedEmail = email.toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return invalid(res, "email must be valid", "INVALID_EMAIL");
        }

        if (!isValidBatchNumber(batchNumber)) {
            return invalid(
                res,
                "Batch number must be exactly 6 alphanumeric characters",
                "INVALID_BATCH_NUMBER"
            );
        }

        if (!isValidDate(joiningDate)) {
            return invalid(
                res,
                "joiningDate must be a valid date",
                "INVALID_DATE"
            );
        }

        const normalizedManagementRank = normalizeOfficerManagementRank(rank);
        if (!normalizedManagementRank || rank !== normalizedManagementRank) {
            return invalid(
                res,
                "rank must be one of: sp, dsp, inspector, si, asi, head_constable, constable",
                "INVALID_OFFICER_RANK",
            );
        }

        const existingUser = await User.findOne({
            $or: [
                { username: username.trim() },
                { email: normalizedEmail },
            ],
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Username or email already exists",
                error: "USER_ALREADY_EXISTS",
            });
        }

        const existingOfficer = await Officer.findOne({
            $or: [
                { officerId: officerId.trim() },
                { badgeNumber: batchNumber },
            ],
        });

        if (existingOfficer) {
            return res.status(409).json({
                success: false,
                message: "Officer ID or badge number already exists",
                error: "OFFICER_ALREADY_EXISTS",
            });
        }

        const passwordHash = await bcrypt.hash(batchNumber, 10);

        session.startTransaction();

        const user = new User({
            username: username.trim(),
            email: normalizedEmail,
            passwordHash,
            role: "officer",
            status: "pending",
            isActive: true,
        });

        await user.save({ session });

        const officer = new Officer({
            userId: user._id,
            officerId: officerId.trim(),
            badgeNumber: batchNumber,
            name: name.trim(),
            rank: normalizedManagementRank,
            department,
            station: station.trim(),
            phoneNumber: phoneNumber.trim(),
            address: address.trim(),
            joiningDate,
            status: "active",
        });

        await officer.save({ session });

        await session.commitTransaction();

        await auditService.log({
            actor: null,
            action: "OFFICER_REGISTRATION_SUBMITTED",
            entityType: "Officer",
            entityId: officer._id,
            after: officer,
            method: req.method,
            path: req.baseUrl + req.path,
        }).catch((error) => console.error("Officer registration audit logging failed:", error.message));

        return res.status(201).json({
            success: true,
            message: "Registration submitted. Your account is pending admin approval.",
            data: {
                id: officer._id,
                officerId: officer.officerId,
                name: officer.name,
                rank: officer.rank,
                department: officer.department,
                station: officer.station,
                status: "pending",
            },
        });
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        console.error("Create officer error:", error);

        return handleError(res, error, "Create officer error");
    } finally {
        await session.endSession();
    }
};

const getAllOfficers = async (req, res) => {
    try {
        const queryValidation = validateOfficerQueryFilters(req.query);
        if (!queryValidation.valid) {
            return res.status(400).json({
                success: false,
                message: queryValidation.message,
                error: queryValidation.error,
            });
        }

        const { search, approvalStatus, accountStatus, searchRegex } = queryValidation.filters;

        if (req.authority?.systemRole === "system_admin") {
            const accounts = await Officer.find()
                .select("userId status")
                .populate("userId", "username email role isActive status");

            const filteredAccounts = accounts.filter((officer) => {
                const user = officer.userId;
                if (!user || user.role !== "officer") return false;
                const resolvedAccountStatus = user.isActive && officer.status === "active" ? "active" : "inactive";
                if (searchRegex && ![user.username, user.email].some((value) => value && searchRegex.test(value))) {
                    return false;
                }
                if (approvalStatus && (user.status || "approved") !== approvalStatus) return false;
                if (accountStatus && resolvedAccountStatus !== accountStatus) return false;
                return true;
            }).map((officer) => ({
                _id: officer._id,
                username: officer.userId.username,
                email: officer.userId.email,
                approvalStatus: officer.userId.status || "approved",
                accountStatus: officer.userId.isActive && officer.status === "active" ? "active" : "inactive",
            }));

            return res.status(200).json({
                success: true,
                count: filteredAccounts.length,
                data: filteredAccounts,
            });
        }

        let officers = await Officer.find()
            .populate("userId", "username email role isActive status")
            .select("-__v");

        if (req.authority?.systemRole !== "system_admin") {
            officers = officers.filter((officer) => isManageableSubordinate(req, officer));
        }

        if (searchRegex) {
            officers = officers.filter((officer) => buildOfficerSearchMatch(officer, searchRegex));
        }

        if (approvalStatus) {
            officers = officers.filter((officer) => (officer.userId?.status || "approved") === approvalStatus);
        }

        if (accountStatus) {
            officers = officers.filter((officer) => Boolean(officer.userId?.isActive) === (accountStatus === "active"));
        }

        return res.status(200).json({
            success: true,
            count: officers.length,
            data: officers,
        });
    } catch (error) {
        console.error("Get officers error:", error);

        return res.status(500).json({
            success: false,
            message: "Server error while fetching officers",
            error: "GET_OFFICERS_ERROR",
        });
    }
};

const getOfficerById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(
                res,
                "Invalid officer ID",
                "INVALID_OFFICER_ID"
            );
        }

        const officer = await Officer.findById(req.params.id)
            .populate("userId", "username email role isActive status")
            .select("-__v");

        if (!officer) {
            return notFound(res, "Officer");
        }

        if (req.authority?.systemRole === "system_admin") {
            const user = officer.userId;
            if (!user || user.role !== "officer") return notFound(res, "Officer");
            return res.status(200).json({
                success: true,
                data: {
                    _id: officer._id,
                    username: user.username,
                    email: user.email,
                    approvalStatus: user.status || "approved",
                    accountStatus: user.isActive && officer.status === "active" ? "active" : "inactive",
                },
            });
        }

        if (req.authority?.systemRole !== "system_admin" && !isManageableSubordinate(req, officer)) {
            return res.status(403).json({
                success: false,
                message: "You may only access officers of a strictly lower rank",
                error: "OFFICER_ACCESS_DENIED",
            });
        }

        return res.status(200).json({
            success: true,
            data: officer,
        });
    } catch (error) {
        console.error("Get officer error:", error);

        return handleError(res, error, "Get officer error");
    }
};

const updateOfficer = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(
                res,
                "Invalid officer ID",
                "INVALID_OFFICER_ID"
            );
        }

        const officer = await Officer.findById(req.params.id)
            .populate("userId", "username email role isActive status");

        if (!officer) {
            return notFound(res, "Officer");
        }

        if (!isManageableSubordinate(req, officer)) {
            return res.status(403).json({
                success: false,
                message: "You may only manage officers of a strictly lower rank",
                error: "OFFICER_MANAGEMENT_DENIED",
            });
        }

        const protectedFields = [
            "rank", "username", "email", "password", "passwordHash",
            "passwordResetToken", "passwordResetExpires", "systemRole", "role",
            "isActive", "status", "createdBy", "updatedBy", "verifiedBy",
            "audit", "auditLog", "jwt", "token",
        ];
        if (protectedFields.some((field) => Object.hasOwn(req.body || {}, field))) {
            return res.status(403).json({
                success: false,
                message: "Officer profile updates cannot change rank or account security fields",
                error: "PROTECTED_OFFICER_FIELD",
            });
        }

        const officerUpdates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) =>
                officerFields.includes(key) && key !== "rank"
            )
        );

        if (!Object.keys(officerUpdates).length) {
            return invalid(
                res,
                "No valid officer fields were provided",
                "NO_UPDATE_FIELDS"
            );
        }

        if (
            officerUpdates.joiningDate !== undefined &&
            !isValidDate(officerUpdates.joiningDate)
        ) {
            return invalid(
                res,
                "joiningDate must be a valid date",
                "INVALID_DATE"
            );
        }

        const stringFields = [
            "officerId",
            "badgeNumber",
            "name",
            "station",
            "phoneNumber",
            "address",
        ];

        for (const field of stringFields) {
            if (
                officerUpdates[field] !== undefined &&
                !isNonEmptyString(officerUpdates[field])
            ) {
                return invalid(
                    res,
                    `${field} must not be empty`,
                    "INVALID_FIELD"
                );
            }
        }

        const officerDuplicateConditions = [];

        if (officerUpdates.officerId) {
            officerDuplicateConditions.push({
                officerId: officerUpdates.officerId,
            });
        }

        if (officerUpdates.badgeNumber) {
            officerDuplicateConditions.push({
                badgeNumber: officerUpdates.badgeNumber,
            });
        }

        if (
            officerDuplicateConditions.length &&
            (await Officer.exists({
                _id: { $ne: officer._id },
                $or: officerDuplicateConditions,
            }))
        ) {
            return res.status(409).json({
                success: false,
                message: "Officer ID or badge number already exists",
                error: "OFFICER_ALREADY_EXISTS",
            });
        }

        const updatedOfficer = await Officer.findByIdAndUpdate(
            req.params.id,
            officerUpdates,
            {
                new: true,
                runValidators: true,
            }
        )
            .populate("userId", "username email role isActive status")
            .select("-__v");

        return res.status(200).json({
            success: true,
            message: "Officer updated successfully",
            data: updatedOfficer,
        });
    } catch (error) {
        console.error("Update officer error:", error);

        return handleError(res, error, "Update officer error");
    }
};

const setOfficerApprovalStatus = (status, message) => async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid officer ID", "INVALID_OFFICER_ID");
        }

        const officer = await Officer.findById(req.params.id);
        if (!officer) return notFound(res, "Officer");

        const user = await User.findById(officer.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Linked user account not found",
                error: "USER_NOT_FOUND",
            });
        }

        if (user.role !== "officer") {
            return res.status(400).json({
                success: false,
                message: "Only officer accounts can be approved or rejected",
                error: "INVALID_ACCOUNT_ROLE",
            });
        }

        if (user.status !== "pending") {
            return res.status(409).json({
                success: false,
                message: "Only pending officer registrations can be reviewed",
                error: "OFFICER_NOT_PENDING",
            });
        }

        user.status = status;
        await user.save();

        return res.status(200).json({
            success: true,
            message,
            data: { id: officer._id, status: user.status },
        });
    } catch (error) {
        return handleError(res, error, "Update officer approval status error");
    }
};

const getAssignableOfficers = async (req, res) => {
    try {
        // Admins have no operational assignment role. Keep the legacy endpoint
        // response shape, but never disclose its operational officer dataset.
        if (req.authority?.systemRole === "system_admin") {
            return res.status(200).json({ success: true, count: 0, data: [] });
        }

        const officers = await Officer.find()
            .populate("userId", "username email role isActive status")
            .select("-__v");

        const assignableOfficers = officers.filter((officer) => {
            const user = officer.userId;
            return (
                user &&
                user.role === "officer" &&
                user.status === "approved" &&
                user.isActive === true &&
                officer.status === "active"
            );
        }).map((officer) => ({
            _id: officer._id,
            name: officer.name,
            username: officer.userId?.username,
            badgeNumber: officer.badgeNumber,
            officerId: officer.officerId,
            rank: officer.rank,
            department: officer.department,
            station: officer.station,
        }));

        return res.status(200).json({
            success: true,
            count: assignableOfficers.length,
            data: assignableOfficers,
        });
    } catch (error) {
        console.error("Get assignable officers error:", error);
        return handleError(res, error, "Get assignable officers error");
    }
};

const updateOfficerAccountStatus = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid officer ID", "INVALID_OFFICER_ID");
        }

        const officer = await Officer.findById(req.params.id);
        if (!officer) {
            return notFound(res, "Officer");
        }

        const accountStatus = normalizeAccountStatus(req.body?.accountStatus);
        if (!accountStatus) {
            return invalid(
                res,
                "accountStatus must be either 'active' or 'inactive'",
                "INVALID_ACCOUNT_STATUS",
            );
        }

        const user = await User.findById(officer.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Linked user account not found",
                error: "USER_NOT_FOUND",
            });
        }

        if (user.role !== "officer") {
            return res.status(400).json({
                success: false,
                message: "Only officer accounts can be activated or deactivated",
                error: "INVALID_ACCOUNT_ROLE",
            });
        }

        officer.status = accountStatus;
        user.isActive = accountStatus === "active";

        await officer.save();
        await user.save();

        return res.status(200).json({
            success: true,
            message: `Officer account ${accountStatus === "active" ? "activated" : "deactivated"} successfully`,
            data: {
                id: officer._id,
                accountStatus: user.isActive ? "active" : "inactive",
                approvalStatus: user.status || "approved",
            },
        });
    } catch (error) {
        return handleError(res, error, "Update officer account status error");
    }
};

const approveOfficer = setOfficerApprovalStatus(
    "approved",
    "Officer registration approved successfully",
);
const rejectOfficer = setOfficerApprovalStatus(
    "rejected",
    "Officer registration rejected successfully",
);

const deleteOfficer = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(
                res,
                "Invalid officer ID",
                "INVALID_OFFICER_ID"
            );
        }

        const officer = await Officer.findById(req.params.id);

        if (!officer) {
            return notFound(res, "Officer");
        }

        const user = await User.findById(officer.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Linked user account not found",
                error: "USER_NOT_FOUND",
            });
        }

        if (user.role !== "officer") {
            return res.status(400).json({
                success: false,
                message: "Only officer accounts can be deactivated",
                error: "INVALID_ACCOUNT_ROLE",
            });
        }

        session.startTransaction();

        officer.status = "inactive";
        await officer.save({ session });

        user.isActive = false;
        await user.save({ session });

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Officer deactivated successfully",
            data: {
                id: officer._id,
                status: officer.status,
                isActive: user.isActive,
                ...(req.authority?.systemRole === "system_admin" ? {} : { officerId: officer.officerId }),
            },
        });
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        console.error("Deactivate officer error:", error);

        return handleError(res, error, "Deactivate officer error");
    } finally {
        await session.endSession();
    }
};

module.exports = {
    registerOfficer,
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer,
    approveOfficer,
    rejectOfficer,
    getAssignableOfficers,
    updateOfficerAccountStatus,
    normalizeOfficerSearchValue,
    normalizeApprovalStatus,
    normalizeAccountStatus,
    validateOfficerAccountStatus,
    buildOfficerFilters,
    validateOfficerQueryFilters,
};
