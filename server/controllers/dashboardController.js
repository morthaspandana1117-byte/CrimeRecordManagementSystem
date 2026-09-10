const User = require("../models/User");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const Report = require("../models/Report");

const getOfficerDashboardStats = async (req, res) => {
    try {
        const [totalFIRs, totalCases, totalEvidence, totalReports] =
            await Promise.all([
            FIR.countDocuments(),
            Case.countDocuments(),
            Evidence.countDocuments(),
            Report.countDocuments(),
        ]);

        res.status(200).json({
            success: true,
            data: {
                totalFIRs,
                totalCases,
                totalEvidence,
                totalReports,
            },
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);

        res.status(500).json({
            success: false,
            message: "Server error while fetching dashboard statistics",
            error: "DASHBOARD_STATS_ERROR",
        });
    }
};

const getAdminDashboardStats = async (req, res) => {
    try {
        const [
            totalUsers,
            totalOfficers,
            totalCriminals,
            totalFIRs,
            totalCases,
            totalEvidence,
            totalReports,
            pendingOfficers,
        ] = await Promise.all([
            User.countDocuments(),
            Officer.countDocuments(),
            Criminal.countDocuments(),
            FIR.countDocuments(),
            Case.countDocuments(),
            Evidence.countDocuments(),
            Report.countDocuments(),
            User.countDocuments({ role: "officer", status: "pending" }),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                totalUsers,
                totalOfficers,
                totalCriminals,
                totalFIRs,
                totalCases,
                totalEvidence,
                totalReports,
                pendingOfficers,
            },
        });
    } catch (error) {
        console.error("Admin dashboard stats error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching dashboard statistics",
            error: "DASHBOARD_STATS_ERROR",
        });
    }
};

module.exports = {
    getOfficerDashboardStats,
    getAdminDashboardStats,
};
