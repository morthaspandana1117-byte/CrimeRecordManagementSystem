const express = require("express");
const { login, getMe } = require("../controllers/authController");
const { registerOfficer } = require("../controllers/officerController");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/register", registerOfficer);
router.get("/me", authMiddleware, getMe);

module.exports = router;
