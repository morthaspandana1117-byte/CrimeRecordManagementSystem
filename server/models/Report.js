const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
    {
        reportId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Case",
            required: true,
        },

        preparedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            required: true,
        },

        reportType: {
            type: String,
            required: true,
            enum: [
                "Investigation Report",
                "Progress Report",
                "Final Report",
                "Forensic Report",
                "Court Report",
            ],
        },

        title: {
            type: String,
            required: true,
            trim: true,
        },

        content: {
            type: String,
            required: true,
            trim: true,
        },

        reportDate: {
            type: Date,
            required: true,
        },

        fileUrl: {
            type: String,
            trim: true,
        },

        status: {
            type: String,
            required: true,
            enum: ["Draft", "Submitted", "Approved", "Rejected"],
            default: "Draft",
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Report", reportSchema);
