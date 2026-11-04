const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Officer = require("../models/Officer");
const {
    normalizeOfficerRank,
    normalizeOfficerManagementRank,
    normalizeSystemRole,
    resolveUserAuthority,
} = require("../middleware/authority");
const { sendPasswordResetEmail } = require("../services/emailService");
const auditService = require("../services/auditService");

const recordAuthEvent = async (event) => {
    try {
        return await auditService.log(event);
    } catch (error) {
        console.error("Authentication audit logging failed:", error.message);
        const wrappedError = Object.assign(new Error("Authentication audit record could not be persisted"), {
            code: "AUDIT_LOGGING_FAILED",
            cause: error,
        });
        wrappedError.hasErrorLabel = (label) => error.hasErrorLabel?.(label) || false;
        wrappedError.errorLabels = error.errorLabels;
        throw wrappedError;
    }
};
const authRoutePath = (req) => req.baseUrl + (req.route?.path || "/unknown");

const persistAuthMutationAndAudit = async ({ event, persist, rollback }) => {
    if (await auditService.isTransactionCapableTopology()) {
        const session = await mongoose.startSession();
        try {
            let result;
            await session.withTransaction(async () => {
                result = await persist(session);
                await recordAuthEvent({ ...event, session });
            });
            return result;
        } finally {
            await session.endSession();
        }
    }

    await persist();
    try {
        await recordAuthEvent(event);
    } catch (error) {
        try {
            await rollback();
        } catch (rollbackError) {
            error.rollbackError = rollbackError;
        }
        throw error;
    }
};

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE =
    "If an account with this email exists, password reset instructions have been sent.";

const hashResetToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

const restoreResetState = async ({ userId, writtenToken, writtenExpiry, previousToken, previousExpiry, passwordHash, writtenPasswordHash }) => {
    const filter = {
        _id: userId,
        passwordResetToken: writtenToken,
        passwordResetExpires: writtenExpiry,
    };
    if (writtenPasswordHash !== undefined) filter.passwordHash = writtenPasswordHash;
    const update = {
        $set: {},
        $unset: {},
    };
    if (passwordHash !== undefined) update.$set.passwordHash = passwordHash;
    if (previousToken === undefined) update.$unset.passwordResetToken = 1;
    else update.$set.passwordResetToken = previousToken;
    if (previousExpiry === undefined) update.$unset.passwordResetExpires = 1;
    else update.$set.passwordResetExpires = previousExpiry;
    if (!Object.keys(update.$set).length) delete update.$set;
    if (!Object.keys(update.$unset).length) delete update.$unset;
    const result = await User.updateOne(filter, update);
    if (result.matchedCount !== 1) {
        throw new Error("Reset-state rollback could not safely restore the original account state");
    }
};

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
        const previousResetToken = user.passwordResetToken;
        const previousResetExpiry = user.passwordResetExpires;
        user.passwordResetToken = hashResetToken(resetToken);
        user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);
        await persistAuthMutationAndAudit({
            event: { actor: user._id, action: "PASSWORD_RESET_REQUESTED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) },
            persist: (session) => user.save(session ? { session } : undefined),
            rollback: async () => {
                await restoreResetState({
                    userId: user._id,
                    writtenToken: user.passwordResetToken,
                    writtenExpiry: user.passwordResetExpires,
                    previousToken: previousResetToken,
                    previousExpiry: previousResetExpiry,
                });
            },
        });
        // Email delivery is external to MongoDB. A delivery failure can leave
        // a valid, audited reset token, so the endpoint still reports failure.
        await sendPasswordResetEmail(user.email, resetToken);
        return res.status(200).json({ success: true, message: GENERIC_RESET_MESSAGE });
    } catch (error) {
        console.error("Forgot password error:", error);
        if (error.code === "AUDIT_LOGGING_FAILED") {
            return res.status(503).json({ success: false, message: "Password reset is temporarily unavailable", error: "AUDIT_LOGGING_FAILED" });
        }
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
        const tokenHash = hashResetToken(token);
        const user = await User.findOne({
            passwordResetToken: tokenHash,
            passwordResetExpires: { $gt: new Date() },
        }).select("+passwordResetToken +passwordResetExpires");

        if (!user || !user.isActive || (user.role === "officer" && (user.status || "approved") !== "approved")) {
            return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
        }
        if (user.role === "officer" && !(await Officer.exists({ userId: user._id, status: "active" }))) {
            return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const previousPasswordHash = user.passwordHash;
        const previousResetToken = user.passwordResetToken;
        const event = {
            actor: user._id,
            action: "PASSWORD_RESET_COMPLETED",
            entityType: "Authentication",
            entityId: user._id,
            method: req.method,
            path: authRoutePath(req),
        };
        const expiry = user.passwordResetExpires;
        if (await auditService.isTransactionCapableTopology()) {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const freshUser = await User.findOne({
                        passwordResetToken: tokenHash,
                        passwordResetExpires: { $gt: new Date() },
                    }).select("+passwordResetToken +passwordResetExpires").session(session).lean();
                    if (
                        !freshUser ||
                        !freshUser.isActive ||
                        (freshUser.role === "officer" && (freshUser.status || "approved") !== "approved") ||
                        (freshUser.role === "officer" && !(await Officer.exists({ userId: freshUser._id, status: "active" }).session(session)))
                    ) {
                        throw Object.assign(new Error("Invalid reset token"), { code: "INVALID_RESET_TOKEN" });
                    }
                    const updated = await User.updateOne(
                        {
                            _id: freshUser._id,
                            passwordResetToken: tokenHash,
                            passwordResetExpires: { $gt: new Date() },
                            isActive: true,
                        },
                        { $set: { passwordHash }, $unset: { passwordResetToken: 1, passwordResetExpires: 1 } },
                        { session },
                    );
                    if (updated.matchedCount !== 1) {
                        throw Object.assign(new Error("Invalid reset token"), { code: "INVALID_RESET_TOKEN" });
                    }
                    await recordAuthEvent({ ...event, session });
                });
            } finally {
                await session.endSession();
            }
        } else {
            const updated = await User.updateOne(
                {
                    _id: user._id,
                    passwordResetToken: tokenHash,
                    passwordResetExpires: { $gt: new Date() },
                    isActive: true,
                },
                { $set: { passwordHash }, $unset: { passwordResetToken: 1, passwordResetExpires: 1 } },
            );
            if (updated.matchedCount !== 1) {
                return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
            }
            try {
                await recordAuthEvent(event);
            } catch (error) {
                try {
                    await restoreResetState({
                        userId: user._id,
                        writtenToken: undefined,
                        writtenExpiry: undefined,
                        previousToken: previousResetToken,
                        previousExpiry: expiry,
                        writtenPasswordHash: passwordHash,
                        passwordHash: previousPasswordHash,
                    });
                } catch (rollbackError) {
                    error.rollbackError = rollbackError;
                }
                throw error;
            }
        }

        return res.status(200).json({ success: true, message: "Password reset successful" });
    } catch (error) {
        console.error("Reset password error:", error);
        if (error.code === "INVALID_RESET_TOKEN") {
            return res.status(400).json({ success: false, message: "This reset link is invalid or has expired", error: "INVALID_RESET_TOKEN" });
        }
        if (error.code === "AUDIT_LOGGING_FAILED") {
            return res.status(503).json({ success: false, message: "Password reset is temporarily unavailable", error: "AUDIT_LOGGING_FAILED" });
        }
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
            await recordAuthEvent({ actor: null, action: "LOGIN_FAILED", entityType: "Authentication", method: req.method, path: authRoutePath(req) });
            return res.status(401).json({
                success: false,
                message: "Invalid username or password",
                error: "INVALID_CREDENTIALS",
            });
        }

        if (!user.isActive) {
            await recordAuthEvent({ actor: user._id, action: "LOGIN_FAILED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });
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
            await recordAuthEvent({ actor: user._id, action: "LOGIN_FAILED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });
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
            await recordAuthEvent({ actor: user._id, action: "LOGIN_FAILED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });
            return res.status(403).json({
                success: false,
                message: "Your account is pending admin approval.",
                error: "ACCOUNT_PENDING_APPROVAL",
            });
        }

        if (user.role === "officer" && accountStatus === "rejected") {
            await recordAuthEvent({ actor: user._id, action: "LOGIN_FAILED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });
            return res.status(403).json({
                success: false,
                message: "Your account was not approved. Please contact an administrator.",
                error: "ACCOUNT_REJECTED",
            });
        }

        const eligibility = await resolveUserAuthority(user);
        if (eligibility.error) {
            await recordAuthEvent({ actor: user._id, action: "LOGIN_FAILED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });
            return res.status(eligibility.status).json({
                success: false,
                message: eligibility.message,
                error: eligibility.error,
            });
        }

        const { systemRole, rank, managementRank } = eligibility.authority;
        const legacyRole = systemRole === "system_admin" ? "admin" : "officer";

        const token = jwt.sign(
            {
                userId: user._id,
                username: user.username,
                role: legacyRole,
                systemRole,
                rank,
                managementRank,
                status: accountStatus,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d",
            },
        );

        await recordAuthEvent({ actor: user._id, action: "LOGIN_SUCCEEDED", entityType: "Authentication", entityId: user._id, method: req.method, path: authRoutePath(req) });

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: legacyRole,
                systemRole,
                rank,
                managementRank,
                status: accountStatus,
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        if (error.code === "AUDIT_LOGGING_FAILED") {
            return res.status(503).json({ success: false, message: "Authentication is temporarily unavailable", error: "AUDIT_LOGGING_FAILED" });
        }

        res.status(500).json({
            success: false,
            message: "Server error during login",
            error: "LOGIN_ERROR",
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = req.authority?.user || await User.findById(req.user.userId).select(
            "-passwordHash",
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                error: "USER_NOT_FOUND",
            });
        }

        const systemRole = normalizeSystemRole(user.role);
        const officer = systemRole === "officer"
            ? req.authority?.officer || await Officer.findOne({ userId: user._id }).select("rank")
            : null;

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: systemRole === "system_admin" ? "admin" : "officer",
                systemRole,
                rank: officer ? normalizeOfficerRank(officer.rank) : null,
                managementRank: officer ? normalizeOfficerManagementRank(officer.rank) : null,
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
