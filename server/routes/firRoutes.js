const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const controller = require("../controllers/firController");
const router = express.Router();
router.use(authMiddleware);
router.route("/").post(controller.createFIR).get(controller.getAllFIRs);
router.route("/:id").get(controller.getFIRById).put(controller.updateFIR).delete(controller.deleteFIR);
module.exports = router;
