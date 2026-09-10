const express = require("express");
const {
    getAdminDashboardStats,
    getOfficerDashboardStats,
} = require("../controllers/dashboardController");
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/stats", authMiddleware, authorizeRoles("officer"), getOfficerDashboardStats);
router.get("/admin/stats", authMiddleware, authorizeRoles("admin"), getAdminDashboardStats);

module.exports = router;
