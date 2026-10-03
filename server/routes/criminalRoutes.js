const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/criminalController");
const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS }));

router.route("/").post(controller.createCriminal).get(controller.getAllCriminals);
router.patch("/:id/status", controller.updateCriminalStatus);
router
    .route("/:id")
    .get(controller.getCriminalById)
    .put(controller.updateCriminal);

module.exports = router;
