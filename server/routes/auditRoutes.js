const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/auditController");

const router = express.Router();
router.use(authMiddleware, resolveAuthority, requireAuthority({ systemRoles: ["system_admin"] }));
router.get("/", controller.listAuditLogs);
router.get("/:id", controller.getAuditLog);

module.exports = router;
