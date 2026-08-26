const mongoose = require("mongoose");

const firSchema = new mongoose.Schema(
    {
        firNo: {
            type: String,
            required: true,
            unique: true,
            trim: true,
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

        registeredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Officer",
            required: true,
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
                "Registered",
                "Under Investigation",
                "Charge Sheet Filed",
                "Closed",
            ],
            default: "Registered",
        },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model("FIR", firSchema);
