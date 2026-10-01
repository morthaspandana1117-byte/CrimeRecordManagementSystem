require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Officer = require("../models/Officer");
const User = require("../models/User");
const { normalizeOfficerRank } = require("../middleware/authority");

const migrateOfficerRanks = async () => {
    await connectDB();

    const officers = await Officer.find().select("rank");
    let migrated = 0;
    let unresolved = 0;

    for (const officer of officers) {
        const normalizedRank = normalizeOfficerRank(officer.rank);
        if (!normalizedRank) {
            unresolved += 1;
            continue;
        }
        if (officer.rank !== normalizedRank) {
            officer.rank = normalizedRank;
            await officer.save();
            migrated += 1;
        }
    }

    const adminResult = await User.updateMany(
        { role: "admin" },
        { $set: { role: "system_admin" } },
    );

    console.log(JSON.stringify({
        migratedOfficerRanks: migrated,
        unresolvedOfficerRanks: unresolved,
        migratedSystemAdmins: adminResult.modifiedCount,
    }));
};

migrateOfficerRanks()
    .catch((error) => {
        console.error("Officer rank migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
