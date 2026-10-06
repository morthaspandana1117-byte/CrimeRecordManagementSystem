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
const auditCapture = require("../middleware/auditCapture");
const {
    OFFICER_RANKS,
    SENIOR_OFFICER_RANKS,
    resolveAuthority,
    requireAuthority,
} = require("../middleware/authority");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(auditCapture);
router.get("/assignable", requireAuthority({ systemRoles: ["system_admin"] }), getAssignableOfficers);
router.get("/", requireAuthority({ systemRoles: ["system_admin"] }), getAllOfficers);
router.get("/:id", requireAuthority({ systemRoles: ["system_admin"] }), getOfficerById);
router.put("/:id", requireAuthority({ systemRoles: ["system_admin"] }), updateOfficer);
router.patch("/:id/approve", requireAuthority({ systemRoles: ["system_admin"] }), approveOfficer);
router.patch("/:id/reject", requireAuthority({ systemRoles: ["system_admin"] }), rejectOfficer);
router.patch("/:id/status", requireAuthority({ systemRoles: ["system_admin"] }), updateOfficerAccountStatus);
router.patch("/:id/deactivate", requireAuthority({ systemRoles: ["system_admin"] }), deleteOfficer);
router.delete("/:id", requireAuthority({ systemRoles: ["system_admin"] }), deleteOfficer);

module.exports = router;
