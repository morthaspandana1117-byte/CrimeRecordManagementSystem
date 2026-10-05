const mongoose = require("mongoose");
const EvidenceCustodyHistory = require("./EvidenceCustodyHistory");

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

        investigationRound: {
            type: Number,
            required: true,
            min: 1,
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

        currentCustodian: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            index: true,
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

        verificationStatus: {
            type: String,
            enum: ["unverified", "verified", "rejected"],
            default: "unverified",
            index: true,
        },

        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        verifiedAt: {
            type: Date,
        },

        verificationNotes: {
            type: String,
            trim: true,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    {
        timestamps: true,
    },
);

evidenceSchema.index({ caseId: 1, investigationRound: 1, collectionDate: -1 });

evidenceSchema.pre("save", async function preSaveEvidence() {
    if (!this.isNew || !this.currentCustodian) {
        return;
    }

    const existing = await EvidenceCustodyHistory.findOne({
        evidenceId: this._id,
        action: "COLLECTED",
        toCustodian: this.currentCustodian,
    }).lean();

    if (!existing) {
        await EvidenceCustodyHistory.create({
            evidenceId: this._id,
            caseId: this.caseId,
            action: "COLLECTED",
            fromCustodian: null,
            toCustodian: this.currentCustodian,
            performedBy: this.createdBy || undefined,
            performedByOfficer: this.currentCustodian,
            remarks: "Evidence collected and recorded",
            timestamp: new Date(),
        });
    }
});

module.exports = mongoose.model("Evidence", evidenceSchema);
