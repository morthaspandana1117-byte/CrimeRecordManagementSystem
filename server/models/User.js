const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        passwordHash: {
            type: String,
            required: true,
        },

        passwordResetToken: {
            type: String,
            select: false,
        },

        passwordResetExpires: {
            type: Date,
            select: false,
        },

        role: {
            type: String,
            enum: ["admin", "officer"],
            default: "officer",
            required: true,
        },

        // This is the account approval state. Officer.status remains the
        // operational/employment state used by the existing officer records.
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "approved",
            required: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            required: true,
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("User", userSchema);
