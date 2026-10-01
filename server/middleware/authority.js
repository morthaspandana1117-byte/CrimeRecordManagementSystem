const User = require("../models/User");
const Officer = require("../models/Officer");

const OFFICER_RANKS = [
    "investigating_officer",
    "inspector",
    "dsp",
    "sp",
];
const SENIOR_OFFICER_RANKS = ["inspector", "dsp", "sp"];

const legacyRankAliases = {
    constable: "investigating_officer",
    "head constable": "investigating_officer",
    asi: "investigating_officer",
    si: "investigating_officer",
    inspector: "inspector",
    dsp: "dsp",
    sp: "sp",
};

const normalizeOfficerRank = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return OFFICER_RANKS.includes(normalized)
        ? normalized
        : legacyRankAliases[normalized] || null;
};

const normalizeSystemRole = (value) => {
    if (value === "admin" || value === "system_admin") return "system_admin";
    return value === "officer" ? "officer" : null;
};

const resolveAuthority = async (req, res, next) => {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
                error: "AUTHENTICATION_REQUIRED",
            });
        }

        const user = await User.findById(req.user.userId).select(
            "role status isActive username email",
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

        const systemRole = normalizeSystemRole(user.role);
        if (!systemRole) {
            return res.status(403).json({
                success: false,
                message: "Unsupported system role",
                error: "UNSUPPORTED_SYSTEM_ROLE",
            });
        }

        let officer = null;
        let rank = null;
        if (systemRole === "officer") {
            if ((user.status || "approved") !== "approved") {
                return res.status(403).json({
                    success: false,
                    message: "Officer account is not approved",
                    error: "OFFICER_NOT_APPROVED",
                });
            }
            officer = await Officer.findOne({ userId: user._id }).select(
                "rank status officerId name",
            );
            if (!officer || officer.status !== "active") {
                return res.status(403).json({
                    success: false,
                    message: "Officer account is not active",
                    error: "OFFICER_INELIGIBLE",
                });
            }
            rank = normalizeOfficerRank(officer.rank);
            if (!rank) {
                return res.status(403).json({
                    success: false,
                    message: "Officer rank is not configured",
                    error: "OFFICER_RANK_REQUIRED",
                });
            }
        }

        req.authority = { systemRole, rank, user, officer };
        req.user.systemRole = systemRole;
        req.user.rank = rank;
        // Preserve the legacy JWT role for existing frontend/API consumers.
        req.user.role = systemRole === "system_admin" ? "admin" : "officer";
        return next();
    } catch (error) {
        console.error("Authority resolution error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error during authorization",
            error: "AUTHORIZATION_ERROR",
        });
    }
};

const requireAuthority = ({ ranks = [], systemRoles = [] } = {}) =>
    (req, res, next) => {
        const authority = req.authority;
        const rankAllowed = authority?.rank && ranks.includes(authority.rank);
        const roleAllowed = authority?.systemRole && systemRoles.includes(authority.systemRole);
        if (!rankAllowed && !roleAllowed) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource",
                error: "INSUFFICIENT_PERMISSIONS",
            });
        }
        return next();
    };

module.exports = {
    OFFICER_RANKS,
    SENIOR_OFFICER_RANKS,
    normalizeOfficerRank,
    normalizeSystemRole,
    resolveAuthority,
    requireAuthority,
};
