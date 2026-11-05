const mongoose = require("mongoose");

const humanReviewHistorySchema = new mongoose.Schema(
    {
        suggestionId: { type: mongoose.Schema.Types.ObjectId, ref: "HumanReviewSuggestion", required: true },
        previousStatus: { type: String, enum: ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"], default: "PENDING" },
        newStatus: { type: String, enum: ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"], required: true },
        reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewerRole: { type: String, default: null },
        reviewComments: { type: String, default: null },
        actionPerformed: { type: String, required: true },
    },
    { timestamps: true },
);

module.exports = mongoose.model("HumanReviewHistory", humanReviewHistorySchema);
