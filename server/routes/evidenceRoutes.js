const express = require("express");
const auth = require("../middleware/authMiddleware");
const controller = require("../controllers/evidenceController");
const router = express.Router();
router.use(auth);
router
    .route("/")
    .post(controller.createEvidence)
    .get(controller.getAllEvidence);
router
    .route("/:id")
    .get(controller.getEvidenceById)
    .put(controller.updateEvidence)
    .delete(controller.deleteEvidence);
module.exports = router;
