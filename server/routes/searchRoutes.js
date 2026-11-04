const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority } = require("../middleware/authority");
const { search } = require("../controllers/searchController");

const router = express.Router();
router.use(authMiddleware, resolveAuthority);
router.get("/", search);

module.exports = router;
