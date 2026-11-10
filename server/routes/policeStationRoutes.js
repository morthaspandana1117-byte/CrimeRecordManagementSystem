const express = require("express");
const controller = require("../controllers/policeStationController");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority, requireAuthority } = require("../middleware/authority");
const auditCapture = require("../middleware/auditCapture");

const router = express.Router();

router.get("/active", controller.listActivePoliceStations);
router.use(authMiddleware, resolveAuthority);
router.use(requireAuthority({ systemRoles: ["system_admin"] }));
router.use(auditCapture);
router.get("/", controller.listPoliceStations);
router.post("/", controller.createPoliceStation);
router.patch("/:id", controller.updatePoliceStation);
router.patch("/:id/status", controller.updatePoliceStationStatus);

module.exports = router;
