const mongoose = require("mongoose");

const evidenceSchema = new mongoose.Schema(
    {
        evidenceId: {
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

        type: {
            type: String,
            required: true,
            enum: [
                "Document",
                "Photograph",
                "Video",
                "Weapon",
                "Biological",
                "Digital",
                "Physical",
                "Other",
            ],
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        collectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            required: true,
        },

        collectionDate: {
            type: Date,
            required: true,
        },

        location: {
            type: String,
            required: true,
            trim: true,
        },

        fileUrl: {
            type: String,
            trim: true,
        },

        status: {
            type: String,
            required: true,
            enum: [
                "Collected",
                "Under Examination",
                "Verified",
                "Stored",
                "Released",
                "Disposed",
            ],
            default: "Collected",
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("Evidence", evidenceSchema);
