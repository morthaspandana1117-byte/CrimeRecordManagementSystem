const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority } = require("../middleware/authority");
const {
    ensureReviewPermission,
    getAllSuggestions,
    getSuggestionDetail,
    getSuggestionHistory,
    createSuggestion,
    acceptSuggestion,
    correctSuggestion,
    rejectSuggestion,
} = require("../controllers/humanReviewController");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(ensureReviewPermission);

router.get("/history", getSuggestionHistory);
router.get("/:id/history", getSuggestionHistory);
router.route("/")
    .get(getAllSuggestions)
    .post(createSuggestion);
router.get("/:id", getSuggestionDetail);
router.post("/:id/accept", acceptSuggestion);
router.post("/:id/correct", correctSuggestion);
router.post("/:id/reject", rejectSuggestion);

module.exports = router;
