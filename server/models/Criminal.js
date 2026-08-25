const mongoose = require("mongoose");

const criminalSchema = new mongoose.Schema(
    {
        criminalId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        fullName: {
            type: String,
            required: true,
            trim: true
        },

        dateOfBirth: {
            type: Date,
            required: true
        },

        gender: {
            type: String,
            required: true,
            enum: [
                "Male",
                "Female",
                "Other"
            ]
        },

        address: {
            type: String,
            required: true,
            trim: true
        },

        phoneNumber: {
            type: String,
            trim: true
        },

        identificationDetails: {
            type: {
                type: String,
                trim: true
            },

            number: {
                type: String,
                trim: true
            },

            description: {
                type: String,
                trim: true
            }
        },

        photo: {
            type: String,
            trim: true
        },

        status: {
            type: String,
            required: true,
            enum: [
                "active",
                "inactive",
                "wanted",
                "arrested",
                "released",
                "deceased"
            ]
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Criminal", criminalSchema);