const User = require("../models/User");
const Officer = require("../models/Officer");

const CANONICAL_OFFICER_RANKS = [
    "sp",
    "dsp",
    "inspector",
    "si",
    "asi",
    "head_constable",
    "constable",
];
const LEGACY_OFFICER_RANKS = ["investigating_officer"];
const OFFICER_RANKS = [
    ...LEGACY_OFFICER_RANKS,
    ...CANONICAL_OFFICER_RANKS,
];
const RESTRICTED_FIELD_RANKS = ["head_constable", "constable"];
const CASE_LIFECYCLE_RANKS = [
    "investigating_officer",
    "si",
    "asi",
    "inspector",
    "dsp",
    "sp",
];
const OFFICER_RANK_HIERARCHY = [
    "sp",
    "dsp",
    "inspector",
    "si",
    "asi",
    "head_constable",
    "constable",
];
const OFFICER_MANAGEMENT_RANKS = ["sp", "dsp", "inspector", "si"];
const SENIOR_OFFICER_RANKS = ["inspector", "dsp", "sp"];

// Legacy operational tiers are retained for existing FIR/case/evidence rules.
// They are intentionally separate from the seven-level management hierarchy.
const legacyRankAliases = {
    investigating_officer: "investigating_officer",
    constable: "investigating_officer",
    head_constable: "investigating_officer",
    "head constable": "investigating_officer",
    asi: "investigating_officer",
    si: "investigating_officer",
    inspector: "inspector",
    dsp: "dsp",
    sp: "sp",
};

const rankAliases = {
    constable: "constable",
    "head constable": "head_constable",
    head_constable: "head_constable",
    asi: "asi",
    si: "si",
    inspector: "inspector",
    dsp: "dsp",
    sp: "sp",
};

const normalizeOfficerManagementRank = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return rankAliases[normalized] || null;
};

const canManageOfficerRank = (managerRank, targetRank) => {
    const manager = normalizeOfficerManagementRank(managerRank);
    const target = normalizeOfficerManagementRank(targetRank);
    if (!manager || !target) return false;
    const managerIndex = OFFICER_RANK_HIERARCHY.indexOf(manager);
    const targetIndex = OFFICER_RANK_HIERARCHY.indexOf(target);
    return managerIndex < 4 && managerIndex < targetIndex;
};

const normalizeOfficerRank = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return OFFICER_RANKS.includes(normalized)
        ? normalized
        : legacyRankAliases[normalized] || null;
};

const isSeniorOfficerRank = (rank) => SENIOR_OFFICER_RANKS.includes(normalizeOfficerRank(rank));
const isRestrictedFieldRank = (rank) => RESTRICTED_FIELD_RANKS.includes(normalizeOfficerRank(rank));
const isCanonicalOfficerRank = (rank) => CANONICAL_OFFICER_RANKS.includes(
    typeof rank === "string" ? rank.trim().toLowerCase() : "",
);
const canAccessAssignedRecord = (authority, assignedOfficerIds = []) =>
    authority?.systemRole === "system_admin" ||
    isSeniorOfficerRank(authority?.rank) ||
    assignedOfficerIds.some((officerId) =>
        String(officerId?._id || officerId) === String(authority?.officer?._id),
    );

const normalizeSystemRole = (value) => {
    if (value === "admin" || value === "system_admin") return "system_admin";
    return value === "officer" ? "officer" : null;
};

const resolveUserAuthority = async (user) => {
    if (!user) {
        return { error: "USER_NOT_FOUND", message: "Authentication required", status: 401 };
    }
    if (!user.isActive) {
        return { error: "ACCOUNT_INACTIVE", message: "User account is inactive", status: 403 };
    }

    const systemRole = normalizeSystemRole(user.role);
    if (!systemRole) {
        return { error: "UNSUPPORTED_SYSTEM_ROLE", message: "Unsupported system role", status: 403 };
    }

    let officer = null;
    let rank = null;
    if (systemRole === "officer") {
        if ((user.status || "approved") !== "approved") {
            return { error: "OFFICER_NOT_APPROVED", message: "Officer account is not approved", status: 403 };
        }
        officer = await Officer.findOne({ userId: user._id }).select(
            "rank status officerId name",
        );
        if (!officer || officer.status !== "active") {
            return { error: "OFFICER_INELIGIBLE", message: "Officer account is not active", status: 403 };
        }
        rank = normalizeOfficerRank(officer.rank);
        if (!rank) {
            return { error: "OFFICER_RANK_REQUIRED", message: "Officer rank is not configured", status: 403 };
        }
    }

    return {
        authority: {
            systemRole,
            rank,
            // Keep ambiguous legacy rank values unresolved for management checks.
            managementRank: officer ? normalizeOfficerManagementRank(officer.rank) : null,
            user,
            officer,
        },
    };
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
        const result = await resolveUserAuthority(user);
        if (result.error) {
            return res.status(result.status).json({
                success: false,
                message: result.message,
                error: result.error,
            });
        }
        req.authority = result.authority;
        const { systemRole, rank } = req.authority;
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

const requireAuthority = ({ ranks = [], managementRanks = [], systemRoles = [] } = {}) =>
    (req, res, next) => {
        const authority = req.authority;
        const rankAllowed = authority?.rank && ranks.includes(authority.rank);
        const managementRankAllowed = authority?.managementRank &&
            managementRanks.includes(authority.managementRank);
        const roleAllowed = authority?.systemRole && systemRoles.includes(authority.systemRole);
        if (!rankAllowed && !managementRankAllowed && !roleAllowed) {
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
    CANONICAL_OFFICER_RANKS,
    LEGACY_OFFICER_RANKS,
    RESTRICTED_FIELD_RANKS,
    CASE_LIFECYCLE_RANKS,
    OFFICER_MANAGEMENT_RANKS,
    SENIOR_OFFICER_RANKS,
    OFFICER_RANK_HIERARCHY,
    normalizeOfficerRank,
    isSeniorOfficerRank,
    isRestrictedFieldRank,
    isCanonicalOfficerRank,
    canAccessAssignedRecord,
    normalizeOfficerManagementRank,
    canManageOfficerRank,
    normalizeSystemRole,
    resolveUserAuthority,
    resolveAuthority,
    requireAuthority,
};
