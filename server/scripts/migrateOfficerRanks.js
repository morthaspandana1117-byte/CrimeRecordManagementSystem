const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Officer = require("../models/Officer");
const User = require("../models/User");
const { normalizeOfficerManagementRank } = require("../middleware/authority");

const classifyOfficerRank = (rank) => {
    const canonicalRank = normalizeOfficerManagementRank(rank);
    return canonicalRank
        ? { status: "migratable", canonicalRank }
        : { status: "unresolved", canonicalRank: null };
};

const migrateOfficerRanks = async () => {
    await connectDB();

    const officers = await Officer.find().select("rank");
    let migrated = 0;
    const unresolvedRanks = [];

    for (const officer of officers) {
        const classification = classifyOfficerRank(officer.rank);
        if (classification.status === "unresolved") {
            unresolvedRanks.push({ officerId: officer._id.toString(), rank: officer.rank });
            continue;
        }
        if (officer.rank !== classification.canonicalRank) {
            officer.rank = classification.canonicalRank;
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
        unresolvedOfficerRankCount: unresolvedRanks.length,
        unresolvedOfficerRanks: unresolvedRanks,
        migratedSystemAdmins: adminResult.modifiedCount,
    }));
};

if (require.main === module) {
    require("dotenv").config();
    migrateOfficerRanks()
        .catch((error) => {
            console.error("Officer rank migration failed:", error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.connection.close();
        });
}

module.exports = { classifyOfficerRank, migrateOfficerRanks };
