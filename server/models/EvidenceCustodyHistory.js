const mongoose = require("mongoose");

const evidenceCustodyHistorySchema = new mongoose.Schema(
    {
        evidenceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Evidence",
            required: true,
            index: true,
        },

        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Case",
            required: true,
            index: true,
        },

        action: {
            type: String,
            required: true,
            trim: true,
            enum: ["COLLECTED", "TRANSFERRED", "RECEIVED", "SUBMITTED", "RELEASED", "RETURNED"],
            index: true,
        },

        fromCustodian: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            default: null,
        },

        toCustodian: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            default: null,
        },

        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            index: true,
        },

        performedByOfficer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            index: true,
        },

        remarks: {
            type: String,
            trim: true,
        },

        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    },
);

evidenceCustodyHistorySchema.index({ evidenceId: 1, timestamp: 1 });

module.exports = mongoose.model("EvidenceCustodyHistory", evidenceCustodyHistorySchema);
