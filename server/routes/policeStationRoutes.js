const express = require("express");
const controller = require("../controllers/policeStationController");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const auditCapture = require("../middleware/auditCapture");

const router = express.Router();

router.get("/active", controller.listActivePoliceStations);
router.use(authMiddleware, resolveAuthority);
router.use(requireAuthority({ systemRoles: ["system_admin"] }));
router.use(auditCapture);
router.post("/", controller.createPoliceStation);
router.patch("/:id/status", controller.updatePoliceStationStatus);

module.exports = router;
