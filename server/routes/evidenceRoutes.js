const express = require("express");
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const controller = require("../controllers/evidenceController");

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles("admin", "officer"));

router.route("/").post(controller.createEvidence).get(controller.getAllEvidence);
router.patch("/:id/status", controller.updateEvidenceStatus);
router
    .route("/:id")
    .get(controller.getEvidenceById)
    .put(controller.updateEvidence)
    .delete(controller.deleteEvidence);

module.exports = router;
