const mongoose = require("mongoose");

const auditSequenceSchema = new mongoose.Schema(
    {
        _id: { type: String, default: "audit-log" },
        nextSequence: { type: Number, required: true, default: 0 },
    },
    { versionKey: false },
);

module.exports = mongoose.model("AuditSequence", auditSequenceSchema);
