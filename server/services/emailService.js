const nodemailer = require("nodemailer");

const getTransporter = () => {
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
};

const sendPasswordResetEmail = async (email, token) => {
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password/${token}`;
    const transporter = getTransporter();

    if (!transporter) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP configuration is required in production");
        }
        console.info(`Password reset URL for ${email}: ${resetUrl}`);
        return;
    }

    await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: "CRMS password reset",
        text: `Reset your CRMS password using this link. It expires in 30 minutes: ${resetUrl}`,
        html: `<p>Reset your CRMS password using the link below. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p>`,
    });
};

module.exports = { sendPasswordResetEmail };