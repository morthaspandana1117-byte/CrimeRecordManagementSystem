const express = require("express");
const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");
const controller = require("../controllers/caseController");

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles("admin", "officer"));

router.route("/").post(controller.createCase).get(controller.getAllCases);
router.patch("/:id/assign-officers", controller.assignCaseOfficers);
router.patch("/:id/status", controller.updateCaseStatus);
router
    .route("/:id")
    .get(controller.getCaseById)
    .put(controller.updateCase)
    .delete(controller.deleteCase);

module.exports = router;
