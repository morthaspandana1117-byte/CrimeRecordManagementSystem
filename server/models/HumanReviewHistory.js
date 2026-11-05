const mongoose = require("mongoose");

const reviewHistorySchema = new mongoose.Schema(
    {
        suggestionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "HumanReviewSuggestion",
            required: true,
            index: true,
        },

        previousStatus: {
            type: String,
            enum: ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"],
            default: "PENDING",
        },

        newStatus: {
            type: String,
            enum: ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"],
            required: true,
        },

        reviewerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        reviewerRole: {
            type: String,
            default: null,
            trim: true,
        },

        previousContent: {
            type: String,
            default: null,
        },

        updatedContent: {
            type: String,
            default: null,
        },

        reviewComments: {
            type: String,
            default: null,
            trim: true,
        },

        actionPerformed: {
            type: String,
            required: true,
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

reviewHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("HumanReviewHistory", reviewHistorySchema);
