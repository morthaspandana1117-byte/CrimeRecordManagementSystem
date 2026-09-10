const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Officer = require("../models/Officer");
const { sendPasswordResetEmail } = require("../services/emailService");

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE =
    "If an account with this email exists, password reset instructions have been sent.";

const hashResetToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

const forgotPassword = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({
            success: false,
            message: "A valid email address is required",
            error: "INVALID_EMAIL",
        });
    }

    try {
        const user = await User.findOne({ email }).select("+passwordResetToken +passwordResetExpires");
        if (!user || !user.isActive || (user.role === "officer" && (user.status || "approved") !== "approved")) {
            return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
        }

        if (user.role === "officer" && !(await Officer.exists({ userId: user._id, status: "active" }))) {
            return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
        }

        const resetToken = crypto.randomBytes(32).toString("hex");
        user.passwordResetToken = hashResetToken(resetToken);
        user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);
        await user.save();

        await sendPasswordResetEmail(user.email, resetToken);
        return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    } catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to send password reset instructions",
            error: "FORGOT_PASSWORD_ERROR",
        });
    }
};

const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!token || typeof password !== "string" || typeof confirmPassword !== "string") {
        return res.status(400).json({ success: false, message: "Password and confirmation are required", error: "MISSING_PASSWORD" });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ success: false, message: "Passwords do not match", error: "PASSWORD_MISMATCH" });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters", error: "WEAK_PASSWORD" });
    }

    try {
        const user = await User.findOne({
            passwordResetToken: hashResetToken(token),
            passwordResetExpires: { $gt: new Date() },
        }).select("+passwordResetToken +passwordResetExpires");

        if (!user || !user.isActive || (user.role === "officer" && (user.status || "approved") !== "approved")) {
            return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
        }
        if (user.role === "officer" && !(await Officer.exists({ userId: user._id, status: "active" }))) {
            return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
        }

        user.passwordHash = await bcrypt.hash(password, 10);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        return res.status(200).json({ success: true, message: "Password reset successful" });
    } catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({ success: false, message: "Unable to reset password", error: "RESET_PASSWORD_ERROR" });
    }
};

const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required",
                error: "MISSING_CREDENTIALS",
            });
        }

        const identifier = username.trim();
        const user = await User.findOne({
            $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password",
                error: "INVALID_CREDENTIALS",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "User account is inactive",
                error: "ACCOUNT_INACTIVE",
            });
        }

        const isPasswordValid = await bcrypt.compare(
            password,
            user.passwordHash,
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password",
                error: "INVALID_CREDENTIALS",
            });
        }

        // Existing user documents created before approval was introduced do
        // not have this field and remain able to sign in as approved users.
        const accountStatus = user.status || "approved";
        if (user.role === "officer" && accountStatus === "pending") {
            return res.status(403).json({
                success: false,
                message: "Your account is pending admin approval.",
                error: "ACCOUNT_PENDING_APPROVAL",
            });
        }

        if (user.role === "officer" && accountStatus === "rejected") {
            return res.status(403).json({
                success: false,
                message: "Your account was not approved. Please contact an administrator.",
                error: "ACCOUNT_REJECTED",
            });
        }

        const token = jwt.sign(
            {
                userId: user._id,
                username: user.username,
                role: user.role,
                status: accountStatus,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d",
            },
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                status: accountStatus,
            },
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Server error during login",
            error: "LOGIN_ERROR",
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select(
            "-passwordHash",
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                error: "USER_NOT_FOUND",
            });
        }

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                status: user.status || "approved",
                isActive: user.isActive,
            },
        });
    } catch (error) {
        console.error("Get current user error:", error);

        res.status(500).json({
            success: false,
            message: "Server error while fetching user",
            error: "GET_USER_ERROR",
        });
    }
};

module.exports = {
    login,
    getMe,
    forgotPassword,
    resetPassword,
};