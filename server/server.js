require("dotenv").config();

const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = require("./config/db");
const createApp = require("./app");

const requiredEnv = ["MONGO_URI", "JWT_SECRET"];
const requiredSmtpEnv = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"];

const validateRequiredEnv = () => {
    const missing = requiredEnv.filter((key) => !process.env[key] || !String(process.env[key]).trim());
    if (missing.length > 0) {
        throw new Error(`Missing required environment variable: ${missing.join(", ")}`);
    }

    const smtpMissing = requiredSmtpEnv.filter((key) => !process.env[key] || !String(process.env[key]).trim());
    if (smtpMissing.length > 0) {
        throw new Error(`Missing required SMTP environment variable: ${smtpMissing.join(", ")}`);
    }
};

validateRequiredEnv();

const app = createApp();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

connectDB().then(() => {
    app.listen(PORT, HOST, () => {
        console.log(`CRMS Backend running on http://${HOST}:${PORT}`);
    });
});
