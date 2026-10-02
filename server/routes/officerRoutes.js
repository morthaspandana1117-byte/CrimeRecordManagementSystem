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
router.get("/assignable", requireAuthority({ ranks: OFFICER_RANKS }), getAssignableOfficers);
router.get("/", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), getAllOfficers);
router.get("/:id", requireAuthority({ ranks: SENIOR_OFFICER_RANKS }), getOfficerById);
router.put("/:id", requireAuthority({ ranks: SENIOR_OFFICER_RANKS }), updateOfficer);
router.patch("/:id/approve", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), approveOfficer);
router.patch("/:id/reject", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), rejectOfficer);
router.patch("/:id/status", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), updateOfficerAccountStatus);
router.patch("/:id/deactivate", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), deleteOfficer);
router.delete("/:id", requireAuthority({ ranks: SENIOR_OFFICER_RANKS, systemRoles: ["system_admin"] }), deleteOfficer);

module.exports = router;