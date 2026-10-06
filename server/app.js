const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const officerRoutes = require("./routes/officerRoutes");
const criminalRoutes = require("./routes/criminalRoutes");
const firRoutes = require("./routes/firRoutes");
const caseRoutes = require("./routes/caseRoutes");
const evidenceRoutes = require("./routes/evidenceRoutes");
const reportRoutes = require("./routes/reportRoutes");
const auditRoutes = require("./routes/auditRoutes");

const createApp = () => {
    const app = express();
    const allowedOrigins = Array.from(new Set([
        process.env.CLIENT_URL,
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ].filter(Boolean)));

    app.disable("x-powered-by");
    app.use(helmet({ crossOriginResourcePolicy: false }));
    app.use(cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(null, false);
        },
        credentials: true,
    }));
    app.use(express.json());

    app.use("/api/auth", authRoutes);
    app.use("/api/dashboard", dashboardRoutes);
    app.use("/api/officers", officerRoutes);
    app.use("/api/criminals", criminalRoutes);
    app.use("/api/firs", firRoutes);
    app.use("/api/cases", caseRoutes);
    app.use("/api/evidence", evidenceRoutes);
    app.use("/api/reports", reportRoutes);
    app.use("/api/audit", auditRoutes);

    app.use((error, req, res, next) => {
        if (error?.type === "entity.parse.failed") {
            return res.status(400).json({
                success: false,
                message: "Request body must be valid JSON",
                error: "INVALID_JSON",
            });
        }

        console.error("Unhandled API error:", error?.message || error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: "INTERNAL_SERVER_ERROR",
        });
    });

    app.get("/", (req, res) => {
        res.send("CRMS Backend is running");
    });

    return app;
};

module.exports = createApp;
