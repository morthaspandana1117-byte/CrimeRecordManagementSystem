const express = require("express");

const {
    createOfficer,
    getAllOfficers,
    getOfficerById,
    updateOfficer,
    deleteOfficer
} = require("../controllers/officerController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authMiddleware, createOfficer);
router.get("/", authMiddleware, getAllOfficers);
router.get("/:id", authMiddleware, getOfficerById);
router.put("/:id", authMiddleware, updateOfficer);
router.delete("/:id", authMiddleware, deleteOfficer);

module.exports = router;
