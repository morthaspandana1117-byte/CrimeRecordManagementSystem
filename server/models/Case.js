const mongoose = require("mongoose");

const caseSchema = new mongoose.Schema(
    {
        caseNo: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        firId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FIR",
            required: true,
            unique: true,
        },

        assignedOfficerIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Officer",
                required: true,
            },
        ],

        criminalIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Criminal",
                required: true,
            },
        ],

        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        startDate: {
            type: Date,
            required: true,
        },

        status: {
            type: String,
            required: true,
            enum: [
                "Open",
                "Under Investigation",
                "Court Proceedings",
                "Closed",
            ],
            default: "Open",
        },

        priority: {
            type: String,
            required: true,
            enum: ["Low", "Medium", "High", "Critical"],
            default: "Medium",
        },

        investigationNotes: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Case", caseSchema);
