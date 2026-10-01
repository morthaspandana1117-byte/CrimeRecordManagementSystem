const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const {
    OFFICER_RANKS,
    SENIOR_OFFICER_RANKS,
    resolveAuthority,
    requireAuthority,
} = require("../middleware/authority");
const controller = require("../controllers/caseController");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS }));

router.route("/").post(controller.createCase).get(controller.getAllCases);
router.patch("/:id/assign-officers", controller.assignCaseOfficers);
router.patch("/:id/reopen", requireAuthority({ ranks: SENIOR_OFFICER_RANKS }), controller.reopenCase);
router.patch("/:id/status", controller.updateCaseStatus);
router
    .route("/:id")
    .get(controller.getCaseById)
    .put(controller.updateCase)
    .delete(controller.deleteCase);

module.exports = router;
