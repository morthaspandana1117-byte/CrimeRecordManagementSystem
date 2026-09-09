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

const { authMiddleware, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware, authorizeRoles("admin"));
router.get("/assignable", getAssignableOfficers);
router.get("/", getAllOfficers);
router.get("/:id", getOfficerById);
router.put("/:id", updateOfficer);
router.patch("/:id/approve", approveOfficer);
router.patch("/:id/reject", rejectOfficer);
router.patch("/:id/status", updateOfficerAccountStatus);
router.patch("/:id/deactivate", deleteOfficer);
router.delete("/:id", deleteOfficer);

module.exports = router;
