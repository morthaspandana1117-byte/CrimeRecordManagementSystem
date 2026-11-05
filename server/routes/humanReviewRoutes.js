const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority } = require("../middleware/authority");
const {
    getAllSuggestions,
    getSuggestionDetail,
    createSuggestion,
    acceptSuggestion,
    correctSuggestion,
    rejectSuggestion,
} = require("../controllers/humanReviewController");

const router = express.Router();

const requireHumanReviewAccess = (req, res, next) => {
    const systemRole = req.authority?.systemRole;
    const rank = req.authority?.rank;
    const allowed = systemRole === "system_admin" || (typeof rank === "string" && ["si", "inspector", "dsp", "sp"].includes(rank));
    if (!allowed) {
        return res.status(403).json({ success: false, message: "You do not have permission to access AI review controls", error: "INSUFFICIENT_PERMISSIONS" });
    }
    return next();
};

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireHumanReviewAccess);

router.get("/", getAllSuggestions);
router.get("/:id", getSuggestionDetail);
router.post("/", createSuggestion);
router.post("/:id/accept", acceptSuggestion);
router.post("/:id/correct", correctSuggestion);
router.post("/:id/reject", rejectSuggestion);

module.exports = router;
