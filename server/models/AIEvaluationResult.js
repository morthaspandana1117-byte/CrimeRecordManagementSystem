const mongoose = require("mongoose");

const categoryValues = [
    "Incorrect Extraction",
    "Missing Sources",
    "Unsupported Claims",
    "Access Boundary Violations",
    "Sensitive Data Handling",
];

const statusValues = ["PASS", "FAIL"];
const severityValues = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const aiEvaluationResultSchema = new mongoose.Schema(
    {
        testCaseId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        category: {
            type: String,
            required: true,
            enum: categoryValues,
            trim: true,
            index: true,
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        expectedBehavior: {
            type: String,
            required: true,
            trim: true,
        },

        actualBehavior: {
            type: String,
            required: true,
            trim: true,
        },

        status: {
            type: String,
            required: true,
            enum: statusValues,
            default: "FAIL",
            trim: true,
            index: true,
        },

        severity: {
            type: String,
            required: true,
            enum: severityValues,
            default: "MEDIUM",
            trim: true,
            index: true,
        },

        failureReason: {
            type: String,
            default: null,
            trim: true,
        },

        recommendedAction: {
            type: String,
            default: null,
            trim: true,
        },

        testInput: {
            type: String,
            default: null,
            trim: true,
        },

        executedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        executedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: true,
    },
);

aiEvaluationResultSchema.index({ executedAt: -1 });

module.exports = mongoose.model("AIEvaluationResult", aiEvaluationResultSchema);
