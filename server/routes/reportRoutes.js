const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const { OFFICER_RANKS, resolveAuthority, requireAuthority } = require("../middleware/authority");
const controller = require("../controllers/reportController");
const { getCrimeStatistics } = require("../controllers/crimeStatisticsController");
const { getMonthlyReport } = require("../controllers/monthlyReportController");
const { getOfficerPerformance } = require("../controllers/officerPerformanceController");
const { exportReportPdf } = require("../controllers/reportPdfController");
const { exportReportExcel } = require("../controllers/reportExcelController");
const auditCapture = require("../middleware/auditCapture");

const router = express.Router();

router.use(authMiddleware);
router.use(resolveAuthority);
router.use(requireAuthority({ ranks: OFFICER_RANKS, systemRoles: ["system_admin"] }));
router.use(auditCapture);

router.get("/crime-statistics", requireAuthority({ ranks: OFFICER_RANKS }), getCrimeStatistics);
router.get("/monthly", requireAuthority({ ranks: OFFICER_RANKS }), getMonthlyReport);
router.get("/officer-performance", requireAuthority({ ranks: OFFICER_RANKS }), getOfficerPerformance);
router.get("/export/pdf", requireAuthority({ ranks: OFFICER_RANKS }), exportReportPdf);
router.get("/export/excel", requireAuthority({ ranks: OFFICER_RANKS }), exportReportExcel);
router.route("/").post(controller.createReport).get(controller.getAllReports);
router
    .route("/:id")
    .get(controller.getReportById)
    .put(controller.updateReport)
    .delete(controller.deleteReport);

module.exports = router;
