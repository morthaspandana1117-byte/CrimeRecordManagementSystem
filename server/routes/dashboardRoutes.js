const express = require("express");
const {
    getAdminDashboardStats,
    getOfficerDashboardStats,
} = require("../controllers/dashboardController");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");

const router = express.Router();

router.get("/stats", authMiddleware, resolveAuthority, requireAuthority({ ranks: OFFICER_RANKS }), getOfficerDashboardStats);
router.get("/admin/stats", authMiddleware, resolveAuthority, requireAuthority({ systemRoles: ["system_admin"] }), getAdminDashboardStats);

module.exports = router;
