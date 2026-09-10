const express = require("express");
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const controller = require("../controllers/firController");

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles("admin", "officer"));

router.route("/").post(controller.createFIR).get(controller.getAllFIRs);
router.patch("/:id/status", controller.updateFIRStatus);
router
    .route("/:id")
    .get(controller.getFIRById)
    .put(controller.updateFIR);

module.exports = router;
