const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { resolveAuthority } = require("../middleware/authority");
const {
    runEvaluation,
    listResults,
    getResultById,
    getSummary,
    getHealth,
} = require("../controllers/aiEvaluationController");

const router = express.Router();

const requireAIEvaluationAccess = (req, res, next) => {
    const systemRole = req.authority?.systemRole;
    const rank = req.authority?.rank;
    const allowed = systemRole === "system_admin" || (typeof rank === "string" && ["si", "inspector", "dsp", "sp"].includes(rank));

    if (!allowed) {
        return res.status(403).json({
            success: false,
            message: "You do not have permission to access AI evaluation controls",
            error: "INSUFFICIENT_PERMISSIONS",
        });
    }

    return next();
};

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAIEvaluationAccess);

router.get("/health", getHealth);
router.post("/run", runEvaluation);
router.get("/results", listResults);
router.get("/results/:id", getResultById);
router.get("/summary", getSummary);

module.exports = router;
