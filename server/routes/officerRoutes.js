const express = require("express");

const {
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer,
    approveOfficer,
    rejectOfficer,
    getAssignableOfficers,
    updateOfficerAccountStatus,
} = require("../controllers/officerController");

const { authMiddleware } = require("../middleware/authMiddleware");
const {
    OFFICER_RANKS,
    SENIOR_OFFICER_RANKS,
    resolveAuthority,
    requireAuthority,
} = require("../middleware/authority");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.get("/assignable", requireAuthority({ ranks: OFFICER_RANKS, systemRoles: ["system_admin"] }), getAssignableOfficers);
router.use(requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }));
router.get("/", getAllOfficers);
router.get("/:id", getOfficerById);
router.put("/:id", updateOfficer);
router.patch("/:id/approve", approveOfficer);
router.patch("/:id/reject", rejectOfficer);
router.patch("/:id/status", updateOfficerAccountStatus);
router.patch("/:id/deactivate", deleteOfficer);
router.delete("/:id", deleteOfficer);

module.exports = router;