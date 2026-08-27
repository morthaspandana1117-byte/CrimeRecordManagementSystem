require("dotenv").config();

const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const officerRoutes = require("./routes/officerRoutes");
const criminalRoutes = require("./routes/criminalRoutes");
const firRoutes = require("./routes/firRoutes");
const caseRoutes = require("./routes/caseRoutes");
const evidenceRoutes = require("./routes/evidenceRoutes");
const reportRoutes = require("./routes/reportRoutes");

const User = require("./models/User");
const Officer = require("./models/Officer");
const Criminal = require("./models/Criminal");
const FIR = require("./models/FIR");
const Case = require("./models/Case");
const Evidence = require("./models/Evidence");
const Report = require("./models/Report");

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

// Return malformed JSON errors as API responses instead of Express's HTML page.
// This does not decode request data: clients must send valid JSON.
app.use((error, req, res, next) => {
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({
            success: false,
            message: "Request body must be valid JSON",
            error: "INVALID_JSON",
        });
    }

    next(error);
});

app.get("/", (req, res) => {
    res.send("CRMS Backend is running");
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`CRMS Backend running on port ${PORT}`);
    });
});
