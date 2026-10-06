const mongoose = require("mongoose");

const officerSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        officerId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        badgeNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            match: [/^[A-Za-z0-9]{6}$/, "Batch number must be exactly 6 alphanumeric characters"],
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        rank: {
            type: String,
            required: true,
            enum: [
                "sp",
                "dsp",
                "inspector",
                "si",
                "asi",
                "head_constable",
                "constable",
                // Existing database records may still carry this ambiguous legacy value.
                // New registration and profile APIs accept only the seven canonical values.
                "investigating_officer",
            ],
        },

        department: {
            type: String,
            required: true,
            enum: [
                "Cyber Crime",
                "Criminal Investigation",
                "Traffic",
                "Law and Order",
            ],
        },

        station: {
            type: String,
            required: true,
            trim: true,
        },

        phoneNumber: {
            type: String,
            required: true,
            trim: true,
        },

        address: {
            type: String,
            required: true,
            trim: true,
        },

        joiningDate: {
            type: Date,
            required: true,
        },

        status: {
            type: String,
            required: true,
            enum: ["active", "inactive", "suspended", "retired"],
            default: "active",
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Officer", officerSchema);
