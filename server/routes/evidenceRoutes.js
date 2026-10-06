const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/evidenceController");
const auditCapture = require("../middleware/auditCapture");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS }));
router.use(auditCapture);

router.route("/").post(controller.createEvidence).get(controller.getAllEvidence);
router.get("/:id/custody", controller.getEvidenceCustodyHistory);
router.post("/:id/custody/transfer", controller.transferEvidenceCustody);
router.patch("/:id/status", controller.updateEvidenceStatus);
router.patch("/:id/verify", requireAuthority({ ranks: ["inspector", "dsp", "sp"] }), controller.verifyEvidence);
router.get("/:id/download", controller.downloadEvidence);
router
    .route("/:id")
    .get(controller.getEvidenceById)
    .put(controller.updateEvidence);

module.exports = router;
