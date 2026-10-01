const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/firController");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS }));

router.route("/").post(controller.createFIR).get(controller.getAllFIRs);
router.patch("/:id/status", controller.updateFIRStatus);
router
    .route("/:id")
    .get(controller.getFIRById)
    .put(controller.updateFIR);

module.exports = router;
