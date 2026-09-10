require("dotenv").config();

const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const User = require("../models/User");

const requiredValues = [
    "ADMIN_USERNAME",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
];

const seedAdmin = async () => {
    const missingValues = requiredValues.filter((key) => !process.env[key]);
    if (missingValues.length) {
        throw new Error(`Missing required environment variables: ${missingValues.join(", ")}`);
    }

    const username = process.env.ADMIN_USERNAME.trim();
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (password.length < 8) {
        throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
    }

    await connectDB();
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });

    if (existingUser) {
        if (existingUser.role !== "admin") {
            throw new Error("A non-admin user already uses this username or email");
        }
        console.log("Admin account already exists; no changes were made.");
        return;
    }

    await User.create({
        username,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: "admin",
        status: "approved",
        isActive: true,
    });
    console.log("Admin account created successfully.");
};

seedAdmin()
    .catch((error) => {
        console.error("Admin seed failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await require("mongoose").connection.close();
    });
