const mongoose = require("mongoose");

const investigationHistorySchema = new mongoose.Schema(
    {
        round: {
            type: Number,
            required: true,
            min: 1,
        },

        startedAt: {
            type: Date,
            required: true,
        },

        startedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        closedAt: Date,
        closedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        closureReason: {
            type: String,
            trim: true,
        },

        reopenReason: {
            type: String,
            trim: true,
        },

        reopenedAt: Date,
        reopenedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        status: {
            type: String,
            enum: ["Open", "Under Investigation", "Court Proceedings", "Closed", "Reopened"],
            required: true,
        },
    },
    { _id: false },
);

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
                "Reopened",
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

        currentInvestigationRound: {
            type: Number,
            min: 0,
            default: 0,
        },

        investigationHistory: {
            type: [investigationHistorySchema],
            default: [],
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Case", caseSchema);
