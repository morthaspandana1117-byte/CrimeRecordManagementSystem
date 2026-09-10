const express = require("express");

const {
    createOfficer,
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer,
} = require("../controllers/officerController");

const authMiddleware = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/authorizeRoles");

const router = express.Router();

router.post("/", authMiddleware, authorizeRoles("admin"), createOfficer);
router.get("/", authMiddleware, authorizeRoles("admin"), getAllOfficers);
router.get("/:id", authMiddleware, authorizeRoles("admin"), getOfficerById);
router.put("/:id", authMiddleware, authorizeRoles("admin"), updateOfficer);
router.patch("/:id/deactivate", authMiddleware, authorizeRoles("admin"), deleteOfficer);
router.delete("/:id", authMiddleware, authorizeRoles("admin"), deleteOfficer);

module.exports = router;
