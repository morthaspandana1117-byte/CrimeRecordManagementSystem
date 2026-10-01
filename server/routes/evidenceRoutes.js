const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/evidenceController");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS }));

router.route("/").post(controller.createEvidence).get(controller.getAllEvidence);
router.patch("/:id/status", controller.updateEvidenceStatus);
router
    .route("/:id")
    .get(controller.getEvidenceById)
    .put(controller.updateEvidence);

module.exports = router;
