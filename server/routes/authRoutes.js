const express = require("express");
const { login, getMe, forgotPassword, resetPassword } = require("../controllers/authController");
const { registerOfficer } = require("../controllers/officerController");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority } = require("../middleware/authority");

const router = express.Router();

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.post("/register", registerOfficer);
router.get("/me", authMiddleware, resolveAuthority, getMe);

module.exports = router;
