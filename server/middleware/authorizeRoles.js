const User = require("../models/User");

const authorizeRoles = (...allowedRoles) => async (req, res, next) => {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
                error: "AUTHENTICATION_REQUIRED",
            });
        }

        const user = await User.findById(req.user.userId).select(
            "role isActive",
        );

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
                error: "USER_NOT_FOUND",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "User account is inactive",
                error: "ACCOUNT_INACTIVE",
            });
        }

        const role = user.role || "officer";

        if (!allowedRoles.includes(role)) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin role required.",
                error: "INSUFFICIENT_PERMISSIONS",
            });
        }

        req.user.role = role;
        next();
    } catch (error) {
        console.error("Role authorization error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error during authorization",
            error: "AUTHORIZATION_ERROR",
        });
    }
};

module.exports = authorizeRoles;
