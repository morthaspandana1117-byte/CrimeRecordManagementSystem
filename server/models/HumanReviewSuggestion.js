const mongoose = require("mongoose");

const reviewStatusValues = ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"];

const suggestionSchema = new mongoose.Schema(
    {
        caseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Case",
            required: true,
            index: true,
        },

        suggestionType: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        relatedRecordId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Case",
            default: null,
        },

        relatedRecordType: {
            type: String,
            default: null,
            trim: true,
        },

        sourceInfo: {
            type: String,
            required: true,
            trim: true,
        },

        originalSuggestion: {
            type: String,
            required: true,
            trim: true,
        },

        aiModel: {
            type: String,
            default: null,
            trim: true,
        },

        generatedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },

        status: {
            type: String,
            enum: reviewStatusValues,
            default: "PENDING",
            index: true,
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        reviewedAt: {
            type: Date,
            default: null,
        },

        correctedSuggestion: {
            type: String,
            default: null,
        },

        reviewRemarks: {
            type: String,
            default: null,
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

suggestionSchema.index({ createdAt: -1 });

module.exports = mongoose.model("HumanReviewSuggestion", suggestionSchema);
