const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const controller = require("../controllers/criminalController");
const router = express.Router();

router.use(authMiddleware);

router.route("/").post(controller.createCriminal).get(controller.getAllCriminals);
router.patch("/:id/status", controller.updateCriminalStatus);
router
    .route("/:id")
    .get(controller.getCriminalById)
    .put(controller.updateCriminal)
    .delete(controller.deleteCriminal);

module.exports = router;
