const nodemailer = require("nodemailer");

const getSMTPDiagnostics = () => ({
    SMTP_HOST: Boolean(process.env.SMTP_HOST),
    SMTP_PORT: Boolean(process.env.SMTP_PORT),
    SMTP_USER: Boolean(process.env.SMTP_USER),
    SMTP_PASSWORD: Boolean(process.env.SMTP_PASSWORD),
});

const getTransporter = () => {
    const smtpStatus = getSMTPDiagnostics();
    const missing = Object.entries(smtpStatus)
        .filter(([, configured]) => !configured)
        .map(([name]) => name);

    if (missing.length > 0) {
        console.warn(`SMTP configuration missing: ${missing.join(", ")}`);
        return null;
    }

    const port = Number(process.env.SMTP_PORT);
    if (!Number.isInteger(port) || port <= 0) {
        console.error("SMTP_PORT is invalid. Expected a numeric port value such as 587.");
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
};

const verifyTransporter = async (transporter) => {
    if (!transporter) {
        throw new Error("SMTP transporter is not configured");
    }

    try {
        await transporter.verify();
        console.info("SMTP transporter verification succeeded.");
        return true;
    } catch (error) {
        let message = "SMTP verification failed";

        if (error?.code === "EAUTH") {
            message =
                "SMTP authentication failed for Gmail. Ensure SMTP_USER and SMTP_PASSWORD are for the same Google account and that SMTP_PASSWORD is a Google App Password.";
        } else if (error?.code === "ECONNECTION") {
            message = "SMTP connection failed. Check SMTP_HOST, SMTP_PORT, and network access.";
        } else if (error?.message) {
            message = `SMTP verification failed: ${error.message}`;
        }

        console.error("SMTP verification failed:", message);
        throw new Error(message);
    }
};

const sendPasswordResetEmail = async (email, token) => {
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password/${token}`;
    const transporter = getTransporter();

    console.info("SMTP diagnostics:", getSMTPDiagnostics());

    if (!transporter) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP configuration is required in production");
        }
        console.info(`Password reset URL for ${email}: ${resetUrl}`);
        return;
    }

    try {
        await verifyTransporter(transporter);

        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: email,
            subject: "CRMS password reset",
            text: `Reset your CRMS password using this link. It expires in 30 minutes: ${resetUrl}`,
            html: `<p>Reset your CRMS password using the link below. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p>`,
        });
    } catch (error) {
        const safeMessage = error?.message || "SMTP email delivery failed";
        console.error("Password reset email failed:", safeMessage);
        throw new Error(safeMessage);
    }
};

module.exports = { sendPasswordResetEmail, getSMTPDiagnostics, getTransporter, verifyTransporter };