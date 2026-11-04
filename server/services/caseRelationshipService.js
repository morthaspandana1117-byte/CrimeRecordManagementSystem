const Case = require("../models/Case");
const Evidence = require("../models/Evidence");
const { canAccessAssignedRecord, isSeniorOfficerRank } = require("../middleware/authority");

const VALID_HASH = /^[a-f0-9]{64}$/i;
const RULES = {
    criminal: {
        label: "Shared criminal record",
    },
    evidence_hash: {
        label: "Identical evidence file hash",
    },
};

const normalizeHash = (value) => (
    typeof value === "string" && VALID_HASH.test(value.trim())
        ? value.trim().toLowerCase()
        : null
);

const normalizeRules = (rules) => {
    const values = Array.isArray(rules) ? rules : [rules];
    const normalized = values
        .filter((value) => typeof value === "string")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean);
    return [...new Set(normalized)];
};

const relationshipFilter = (candidateIds, authority) => ({
    _id: { $in: candidateIds },
    ...(isSeniorOfficerRank(authority?.rank)
        ? {}
        : authority?.officer?._id
            ? { assignedOfficerIds: authority.officer._id }
            : { _id: { $in: [] } }),
});

const analyzeCaseRelationships = async ({ caseId, authority, rules = ["criminal", "evidence_hash"], page = 1, limit = 20 }) => {
    if (authority?.systemRole !== "officer") return { forbidden: true };
    const sourceCase = await Case.findById(caseId).select("_id criminalIds assignedOfficerIds").lean();
    if (!sourceCase) return { notFound: true };
    if (!canAccessAssignedRecord(authority, sourceCase.assignedOfficerIds)) return { forbidden: true };

    const selectedRules = normalizeRules(rules);
    const relationships = new Map();
    const addReason = (candidateId, rule) => {
        const key = String(candidateId);
        const relationship = relationships.get(key) || { caseId: candidateId, reasons: [] };
        if (!relationship.reasons.includes(RULES[rule].label)) relationship.reasons.push(RULES[rule].label);
        relationships.set(key, relationship);
    };

    if (selectedRules.includes("criminal") && sourceCase.criminalIds?.length) {
        const criminalMatches = await Case.find({
            _id: { $ne: sourceCase._id },
            criminalIds: { $in: sourceCase.criminalIds },
        }).select("_id").lean();
        criminalMatches.forEach((match) => addReason(match._id, "criminal"));
    }

    if (selectedRules.includes("evidence_hash")) {
        const sourceEvidence = await Evidence.find({ caseId: sourceCase._id })
            .select("fileHash")
            .lean();
        const hashes = [...new Set(sourceEvidence.map((item) => normalizeHash(item.fileHash)).filter(Boolean))];
        if (hashes.length) {
            const evidenceMatches = await Evidence.find({
                caseId: { $ne: sourceCase._id },
                fileHash: { $in: hashes.map((hash) => new RegExp(`^${hash}$`, "i")) },
            }).select("caseId fileHash").lean();
            evidenceMatches.forEach((match) => {
                if (normalizeHash(match.fileHash)) addReason(match.caseId, "evidence_hash");
            });
        }
    }

    const candidateIds = [...relationships.keys()];
    if (!candidateIds.length) {
        return {
            data: [],
            pagination: { page, limit, totalRecords: 0, totalPages: 1 },
        };
    }

    const authorizedCandidates = await Case.find(relationshipFilter(candidateIds, authority))
        .select("_id caseNo title status assignedOfficerIds")
        .lean();
    const visibleIds = new Set(authorizedCandidates
        .filter((candidate) => canAccessAssignedRecord(authority, candidate.assignedOfficerIds))
        .map((candidate) => String(candidate._id)));
    const visibleRelationships = authorizedCandidates
        .filter((candidate) => visibleIds.has(String(candidate._id)))
        .map((candidate) => ({
            caseId: candidate._id,
            caseNo: candidate.caseNo,
            title: candidate.title,
            status: candidate.status,
            reasons: relationships.get(String(candidate._id))?.reasons || [],
        }))
        .sort((left, right) => String(left.caseNo).localeCompare(String(right.caseNo)));

    const totalRecords = visibleRelationships.length;
    return {
        data: visibleRelationships.slice((page - 1) * limit, page * limit),
        pagination: {
            page,
            limit,
            totalRecords,
            totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        },
    };
};

module.exports = {
    VALID_HASH,
    normalizeHash,
    normalizeRules,
    analyzeCaseRelationships,
};
