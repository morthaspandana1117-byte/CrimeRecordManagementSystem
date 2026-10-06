const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
        action: { type: String, required: true, immutable: true, trim: true },
        entityType: { type: String, required: true, immutable: true, trim: true },
        entityId: { type: mongoose.Schema.Types.ObjectId, immutable: true, default: null },
        occurredAt: { type: Date, required: true, immutable: true, default: Date.now },
        changes: {
            before: { type: mongoose.Schema.Types.Mixed, immutable: true },
            after: { type: mongoose.Schema.Types.Mixed, immutable: true },
        },
        metadata: {
            method: { type: String, immutable: true },
            path: { type: String, immutable: true },
        },
    },
    { timestamps: false, versionKey: false, strict: true },
);

auditLogSchema.pre("save", function preventAuditEdits() {
    if (!this.isNew) throw new Error("Audit records are append-only");
});

for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    auditLogSchema.pre(operation, function preventAuditMutation() {
        throw new Error("Audit records are append-only");
    });
}
auditLogSchema.pre("deleteOne", { document: true, query: false }, function preventDocumentDelete() {
    throw new Error("Audit records are append-only");
});

auditLogSchema.index({ occurredAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
auditLogSchema.index({ actor: 1, occurredAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
