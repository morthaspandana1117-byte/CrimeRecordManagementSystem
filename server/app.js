const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const officerRoutes = require("./routes/officerRoutes");
const criminalRoutes = require("./routes/criminalRoutes");
const firRoutes = require("./routes/firRoutes");
const caseRoutes = require("./routes/caseRoutes");
const evidenceRoutes = require("./routes/evidenceRoutes");
const reportRoutes = require("./routes/reportRoutes");

const createApp = () => {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.use("/api/auth", authRoutes);
    app.use("/api/dashboard", dashboardRoutes);
    app.use("/api/officers", officerRoutes);
    app.use("/api/criminals", criminalRoutes);
    app.use("/api/firs", firRoutes);
    app.use("/api/cases", caseRoutes);
    app.use("/api/evidence", evidenceRoutes);
    app.use("/api/reports", reportRoutes);

    app.use((error, req, res, next) => {
        if (error?.type === "entity.parse.failed") {
            return res.status(400).json({
                success: false,
                message: "Request body must be valid JSON",
                error: "INVALID_JSON",
            });
        }

        return next(error);
    });

    app.get("/", (req, res) => {
        res.send("CRMS Backend is running");
    });

    return app;
};

module.exports = createApp;
