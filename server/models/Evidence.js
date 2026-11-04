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

        pendingCustodyTransfer: {
            type: new mongoose.Schema({
                transferId: { type: mongoose.Schema.Types.ObjectId, required: true },
                fromCustodian: { type: mongoose.Schema.Types.ObjectId, ref: "Officer", required: true },
                toCustodian: { type: mongoose.Schema.Types.ObjectId, ref: "Officer", required: true },
                initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                initiatedByOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "Officer", required: true },
                initiatedAt: { type: Date, required: true },
                remarks: { type: String, trim: true },
            }, { _id: false }),
            default: undefined,
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

        fileHash: { type: String, match: /^[a-f0-9]{64}$/i },
        fileName: { type: String, trim: true },
        storedFilename: { type: String, select: false },
        mimeType: { type: String, trim: true },
        fileSize: { type: Number, min: 0 },
        uploadedAt: { type: Date },

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

    const session = this.$session();
    const existingQuery = EvidenceCustodyHistory.findOne({
        evidenceId: this._id,
        action: "COLLECTED",
        toCustodian: this.currentCustodian,
    });
    if (session) existingQuery.session(session);
    const existing = await existingQuery.lean();

    if (!existing) {
        const custodyEntry = {
            evidenceId: this._id,
            caseId: this.caseId,
            action: "COLLECTED",
            fromCustodian: null,
            toCustodian: this.currentCustodian,
            performedBy: this.createdBy || undefined,
            performedByOfficer: this.currentCustodian,
            remarks: "Evidence collected and recorded",
            timestamp: new Date(),
        };
        if (session) await EvidenceCustodyHistory.create([custodyEntry], { session });
        else await EvidenceCustodyHistory.create(custodyEntry);
    }
});

module.exports = mongoose.model("Evidence", evidenceSchema);
