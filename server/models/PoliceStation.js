const mongoose = require("mongoose");

const normalizeName = (value) =>
    typeof value === "string"
        ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
        : value;

const policeStationSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 120,
            validate: {
                validator(value) {
                    return typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value);
                },
                message: "Station name contains unsupported characters",
            },
        },
        normalizedName: {
            type: String,
            required: true,
            select: false,
        },
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            minlength: 2,
            maxlength: 24,
            match: /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
        },
        state: {
            type: String,
            trim: true,
            maxlength: 120,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    { timestamps: true },
);

policeStationSchema.pre("validate", function setNormalizedName() {
    this.name = normalizeName(this.name);
    if (this.name) this.normalizedName = this.name.toLowerCase();
    if (this.code) this.code = this.code.trim().toUpperCase();
});

policeStationSchema.index({ normalizedName: 1 }, { unique: true });
policeStationSchema.index({ code: 1 }, { unique: true });
policeStationSchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model("PoliceStation", policeStationSchema);
