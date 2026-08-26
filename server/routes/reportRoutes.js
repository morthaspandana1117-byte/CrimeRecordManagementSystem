const express = require("express");
const auth = require("../middleware/authMiddleware");
const controller = require("../controllers/reportController");
const router = express.Router();
router.use(auth);
router.route("/").post(controller.createReport).get(controller.getAllReports);
router
    .route("/:id")
    .get(controller.getReportById)
    .put(controller.updateReport)
    .delete(controller.deleteReport);
module.exports = router;
