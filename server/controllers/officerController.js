const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Officer = require("../models/Officer");

const {
    isValidObjectId,
    isValidDate,
    isNonEmptyString,
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

const createOfficer = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const {
            username,
            email,
            officerId,
            badgeNumber,
            name,
            rank,
            department,
            station,
            phoneNumber,
            address,
            joiningDate,
            status,
        } = req.body;

        if (
            !username ||
            !email ||
            !officerId ||
            !badgeNumber ||
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
            badgeNumber,
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
                { badgeNumber: badgeNumber.trim() },
            ],
        });

        if (existingOfficer) {
            return res.status(409).json({
                success: false,
                message: "Officer ID or badge number already exists",
                error: "OFFICER_ALREADY_EXISTS",
            });
        }

        const passwordHash = await bcrypt.hash(badgeNumber.trim(), 10);

        session.startTransaction();

        const user = new User({
            username: username.trim(),
            email: normalizedEmail,
            passwordHash,
            role: "officer",
            isActive: true,
        });

        await user.save({ session });

        const officer = new Officer({
            userId: user._id,
            officerId: officerId.trim(),
            badgeNumber: badgeNumber.trim(),
            name: name.trim(),
            rank,
            department,
            station: station.trim(),
            phoneNumber: phoneNumber.trim(),
            address: address.trim(),
            joiningDate,
            status: status || "active",
        });

        await officer.save({ session });

        await session.commitTransaction();

        return res.status(201).json({
            success: true,
            message: "Officer created successfully",
            data: {
                id: officer._id,
                officerId: officer.officerId,
                name: officer.name,
                rank: officer.rank,
                department: officer.department,
                station: officer.station,
                status: officer.status,
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
            .populate("userId", "username email isActive role")
            .select("-badgeNumber -__v");

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
            .populate("userId", "username email isActive role")
            .select("-badgeNumber -__v");

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

        if (
            !Object.keys(officerUpdates).length &&
            !Object.keys(userUpdates).length
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

        let newPasswordHash = null;

        if (officerUpdates.badgeNumber) {
            newPasswordHash = await bcrypt.hash(
                officerUpdates.badgeNumber,
                10
            );
        }

        session.startTransaction();

        if (Object.keys(userUpdates).length || newPasswordHash) {
            const userUpdateData = {
                ...userUpdates,
            };

            if (newPasswordHash) {
                userUpdateData.passwordHash = newPasswordHash;
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
            .populate("userId", "username email isActive role")
            .select("-badgeNumber -__v");

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
    createOfficer,
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer,
};