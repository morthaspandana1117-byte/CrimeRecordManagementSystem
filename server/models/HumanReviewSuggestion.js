const mongoose = require("mongoose");

const humanReviewSuggestionSchema = new mongoose.Schema(
    {
        caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
        suggestionType: { type: String, required: true, trim: true },
        sourceInfo: { type: String, required: true, trim: true },
        originalSuggestion: { type: String, required: true, trim: true },
        correctedSuggestion: { type: String, default: null },
        status: { type: String, enum: ["PENDING", "ACCEPTED", "CORRECTED", "REJECTED"], default: "PENDING" },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewedAt: { type: Date, default: null },
        reviewRemarks: { type: String, default: null },
    },
    { timestamps: true },
);

module.exports = mongoose.model("HumanReviewSuggestion", humanReviewSuggestionSchema);
