const mongoose = require("mongoose");

const firSchema = new mongoose.Schema(
    {
        firNo: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },

        date: {
            type: Date,
            required: true,
        },

        policeStation: {
            type: String,
            required: true,
            trim: true,
        },

        policeStationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PoliceStation",
            validate: {
                async validator(value) {
                    if (value == null) return true;
                    const PoliceStation = mongoose.models.PoliceStation || require("./PoliceStation");
                    return Boolean(await PoliceStation.exists({ _id: value, isActive: true }));
                },
                message: "policeStationId must reference an active police station",
            },
        },

        complaint: {
            complainantName: {
                type: String,
                required: true,
                trim: true,
            },

            complainantPhone: {
                type: String,
                trim: true,
            },

            complaintText: {
                type: String,
                required: true,
                trim: true,
            },
        },

        description: {
            type: String,
            required: true,
            trim: true,
        },

        crimeType: {
            type: String,
            required: true,
            enum: [
                "Theft",
                "Robbery",
                "Murder",
                "Assault",
                "Kidnapping",
                "Fraud",
                "Cyber Crime",
                "Drug Offense",
                "Sexual Offense",
                "Property Crime",
                "Other",
            ],
        },

        location: {
            address: {
                type: String,
                required: true,
                trim: true,
            },

            city: {
                type: String,
                required: true,
                trim: true,
            },

            state: {
                type: String,
                required: true,
                trim: true,
            },

            pincode: {
                type: String,
                required: true,
                trim: true,
            },
        },

        latitude: {
            type: Number,
            min: -90,
            max: 90,
        },

        longitude: {
            type: Number,
            min: -180,
            max: 180,
        },

        registeredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            required: true,
            index: true,
        },

        criminalIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Criminal",
                required: true,
            },
        ],

        status: {
            type: String,
            required: true,
            enum: [
                "Open",
                "Registered",
                "Under Investigation",
                "Charge Sheet Filed",
                "Closed",
            ],
            default: "Open",
        },
    },
    {
        timestamps: true,
    },
);

firSchema.index({ policeStationId: 1 });

module.exports = mongoose.model("FIR", firSchema);
