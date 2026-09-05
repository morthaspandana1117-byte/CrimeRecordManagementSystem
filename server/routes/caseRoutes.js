const express = require("express");
const { authMiddleware: auth } = require("../middleware/authMiddleware");
const controller = require("../controllers/caseController");
const router = express.Router();
router.use(auth);
router.route("/").post(controller.createCase).get(controller.getAllCases);
router
    .route("/:id")
    .get(controller.getCaseById)
    .put(controller.updateCase)
    .delete(controller.deleteCase);
module.exports = router;
