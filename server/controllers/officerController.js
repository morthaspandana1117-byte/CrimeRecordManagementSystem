const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Officer = require("../models/Officer");
const { isValidObjectId, isValidDate, isNonEmptyString, invalid, notFound, handleError } = require("./controllerUtils");

const officerFields = ["officerId", "badgeNumber", "name", "rank", "department", "station", "phoneNumber", "address", "joiningDate", "status"];

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
            status
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
                error: "MISSING_REQUIRED_FIELDS"
            });
        }

        const existingUser = await User.findOne({
            $or: [
                { username },
                { email: email.toLowerCase() }
            ]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Username or email already exists",
                error: "USER_ALREADY_EXISTS"
            });
        }

        const existingOfficer = await Officer.findOne({
            $or: [
                { officerId },
                { badgeNumber }
            ]
        });

        if (existingOfficer) {
            return res.status(409).json({
                success: false,
                message: "Officer ID or badge number already exists",
                error: "OFFICER_ALREADY_EXISTS"
            });
        }

        const passwordHash = await bcrypt.hash(badgeNumber, 10);

        session.startTransaction();

        const user = new User({
            username,
            email: email.toLowerCase(),
            passwordHash,
            role: "officer",
            isActive: true
        });

        await user.save({ session });

        const officer = new Officer({
            userId: user._id,
            officerId,
            badgeNumber,
            name,
            rank,
            department,
            station,
            phoneNumber,
            address,
            joiningDate,
            status: status || "active"
        });

        await officer.save({ session });

        await session.commitTransaction();

        res.status(201).json({
            success: true,
            message: "Officer created successfully",
            data: {
                officerId: officer.officerId,
                name: officer.name,
                rank: officer.rank,
                department: officer.department,
                station: officer.station,
                status: officer.status
            }
        });

    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        console.error("Create officer error:", error);

        res.status(500).json({
            success: false,
            message: "Server error while creating officer",
            error: "CREATE_OFFICER_ERROR"
        });
    } finally {
        await session.endSession();
    }
};

const getAllOfficers = async (req, res) => {
    try {
        const officers = await Officer.find()
            .populate("userId", "username email isActive")
            .select("-badgeNumber -__v");

        res.status(200).json({
            success: true,
            count: officers.length,
            data: officers
        });
    } catch (error) {
        console.error("Get officers error:", error);

        res.status(500).json({
            success: false,
            message: "Server error while fetching officers",
            error: "GET_OFFICERS_ERROR"
        });
    }
};

const getOfficerById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return invalid(res, "Invalid officer ID", "INVALID_OFFICER_ID");
        }
        const officer = await Officer.findById(req.params.id)
            .populate("userId", "username email isActive")
            .select("-badgeNumber -__v");

        if (!officer) {
            return res.status(404).json({
                success: false,
                message: "Officer not found",
                error: "OFFICER_NOT_FOUND"
            });
        }

        res.status(200).json({
            success: true,
            data: officer
        });
    } catch (error) {
        console.error("Get officer error:", error);

        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid officer ID",
                error: "INVALID_OFFICER_ID"
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error while fetching officer",
            error: "GET_OFFICER_ERROR"
        });
    }
};

const updateOfficer = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid officer ID", "INVALID_OFFICER_ID");
        const officerUpdates = Object.fromEntries(Object.entries(req.body).filter(([key]) => officerFields.includes(key)));
        const userUpdates = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["username", "email"].includes(key)));
        if (!Object.keys(officerUpdates).length && !Object.keys(userUpdates).length) return invalid(res, "No valid officer fields were provided");
        if (officerUpdates.joiningDate !== undefined && !isValidDate(officerUpdates.joiningDate)) return invalid(res, "joiningDate must be a valid date");
        if (Object.entries({ ...officerUpdates, ...userUpdates }).some(([key, value]) => ["officerId", "badgeNumber", "name", "station", "phoneNumber", "address", "username"].includes(key) && !isNonEmptyString(value))) return invalid(res, "String fields must not be empty");
        if (userUpdates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userUpdates.email)) return invalid(res, "email must be valid");
        const officer = await Officer.findById(req.params.id);
        if (!officer) return notFound(res, "Officer");
        if (userUpdates.email) userUpdates.email = userUpdates.email.toLowerCase();
        if (Object.keys(userUpdates).length && await User.exists({ _id: { $ne: officer.userId }, $or: Object.entries(userUpdates).map(([key, value]) => ({ [key]: value })) })) return res.status(409).json({ success: false, message: "Username or email already exists", error: "USER_ALREADY_EXISTS" });
        const checks = [officerUpdates.officerId && { officerId: officerUpdates.officerId }, officerUpdates.badgeNumber && { badgeNumber: officerUpdates.badgeNumber }].filter(Boolean);
        if (checks.length && await Officer.exists({ _id: { $ne: officer._id }, $or: checks })) return res.status(409).json({ success: false, message: "Officer ID or badge number already exists", error: "OFFICER_ALREADY_EXISTS" });
        session.startTransaction();
        if (Object.keys(userUpdates).length) await User.findByIdAndUpdate(officer.userId, userUpdates, { runValidators: true, session });
        const updatedOfficer = await Officer.findByIdAndUpdate(req.params.id, officerUpdates, { new: true, runValidators: true, session }).populate("userId", "username email isActive").select("-badgeNumber -__v");
        await session.commitTransaction();
        return res.status(200).json({ success: true, message: "Officer updated successfully", data: updatedOfficer });
    } catch (error) { if (session.inTransaction()) await session.abortTransaction(); return handleError(res, error, "Update officer error"); } finally { await session.endSession(); }
};

const deleteOfficer = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid officer ID", "INVALID_OFFICER_ID");
        const officer = await Officer.findById(req.params.id);
        if (!officer) return notFound(res, "Officer");
        session.startTransaction();
        officer.status = "inactive";
        await officer.save({ session });
        await User.findByIdAndUpdate(officer.userId, { isActive: false }, { session });
        await session.commitTransaction();
        return res.status(200).json({ success: true, message: "Officer deactivated successfully", data: { id: officer._id, status: officer.status } });
    } catch (error) { if (session.inTransaction()) await session.abortTransaction(); return handleError(res, error, "Deactivate officer error"); } finally { await session.endSession(); }
};

module.exports = {
    createOfficer,
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer
};
