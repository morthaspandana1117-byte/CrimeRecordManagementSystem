const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Officer = require("../models/Officer");

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
    "status",
];

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
            rank,
            department,
            station: station.trim(),
            phoneNumber: phoneNumber.trim(),
            address: address.trim(),
            joiningDate,
            status: "active",
        });

        await officer.save({ session });

        await session.commitTransaction();

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
        const officers = await Officer.find()
            .populate("userId", "username email isActive role status")
            .select("-__v");

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
            .populate("userId", "username email isActive role status")
            .select("-__v");

        if (!officer) {
            return notFound(res, "Officer");
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

        const officerUpdates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) =>
                officerFields.includes(key)
            )
        );

        const userUpdates = Object.fromEntries(
            Object.entries(req.body).filter(([key]) =>
                ["username", "email"].includes(key)
            )
        );
        const password = req.body.password;

        if (
            !Object.keys(officerUpdates).length &&
            !Object.keys(userUpdates).length &&
            password === undefined
        ) {
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

        if (
            userUpdates.username !== undefined &&
            !isNonEmptyString(userUpdates.username)
        ) {
            return invalid(
                res,
                "username must not be empty",
                "INVALID_USERNAME"
            );
        }

        if (userUpdates.email !== undefined) {
            if (!isNonEmptyString(userUpdates.email)) {
                return invalid(
                    res,
                    "email must not be empty",
                    "INVALID_EMAIL"
                );
            }

            userUpdates.email = userUpdates.email.toLowerCase();

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userUpdates.email)
            ) {
                return invalid(
                    res,
                    "email must be valid",
                    "INVALID_EMAIL"
                );
            }
        }

        if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
            return invalid(
                res,
                "password must be at least 8 characters long",
                "INVALID_PASSWORD"
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

        if (Object.keys(userUpdates).length) {
            const userDuplicateConditions = [];

            if (userUpdates.username) {
                userDuplicateConditions.push({
                    username: userUpdates.username,
                });
            }

            if (userUpdates.email) {
                userDuplicateConditions.push({
                    email: userUpdates.email,
                });
            }

            if (
                userDuplicateConditions.length &&
                (await User.exists({
                    _id: { $ne: officer.userId },
                    $or: userDuplicateConditions,
                }))
            ) {
                return res.status(409).json({
                    success: false,
                    message: "Username or email already exists",
                    error: "USER_ALREADY_EXISTS",
                });
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

        const newPasswordHash = password ? await bcrypt.hash(password, 10) : null;

        session.startTransaction();

        if (Object.keys(userUpdates).length || newPasswordHash) {
            const userUpdateData = {
                ...userUpdates,
            };

            if (newPasswordHash) {
                userUpdateData.passwordHash = newPasswordHash;
            }

            if (officerUpdates.status !== undefined) {
                userUpdateData.isActive = officerUpdates.status === "active";
            }

            await User.findByIdAndUpdate(
                officer.userId,
                userUpdateData,
                {
                    new: true,
                    runValidators: true,
                    session,
                }
            );
        }

        const updatedOfficer = await Officer.findByIdAndUpdate(
            req.params.id,
            officerUpdates,
            {
                new: true,
                runValidators: true,
                session,
            }
        )
            .populate("userId", "username email isActive role status")
            .select("-__v");

        await session.commitTransaction();

        return res.status(200).json({
            success: true,
            message: "Officer updated successfully",
            data: updatedOfficer,
        });
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        console.error("Update officer error:", error);

        return handleError(res, error, "Update officer error");
    } finally {
        await session.endSession();
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
                officerId: officer.officerId,
                status: officer.status,
                isActive: user.isActive,
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
};
