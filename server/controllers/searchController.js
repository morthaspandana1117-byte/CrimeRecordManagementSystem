const mongoose = require("mongoose");
const Case = require("../models/Case");
const FIR = require("../models/FIR");
const Criminal = require("../models/Criminal");
const Officer = require("../models/Officer");
const User = require("../models/User");
const Evidence = require("../models/Evidence");
const { invalid, handleError } = require("./controllerUtils");
const {
    isSeniorOfficerRank,
    OFFICER_MANAGEMENT_RANKS,
    canManageOfficerRank,
} = require("../middleware/authority");

const categories = ["cases", "firs", "criminals", "officers", "evidence"];
const allowedQueryFields = new Set([
    "category", "keyword", "status", "priority", "assignedOfficerId", "createdFrom", "createdTo",
    "updatedFrom", "updatedTo", "crimeType", "policeStation", "dateFrom", "dateTo", "rank", "station",
    "accountStatus", "type", "verificationStatus", "caseId", "uploadedFrom", "uploadedTo",
    "page", "limit", "sortBy", "sortDirection",
]);
const statuses = {
    cases: ["Open", "Under Investigation", "Court Proceedings", "Closed", "Reopened"],
    firs: ["Open", "Registered", "Under Investigation", "Charge Sheet Filed", "Closed"],
    criminals: ["active", "inactive", "wanted", "arrested", "released", "deceased"],
    evidence: ["Collected", "Under Examination", "Verified", "Stored", "Released", "Disposed"],
};
const priorities = ["Low", "Medium", "High", "Critical"];
const evidenceTypes = ["Document", "Photograph", "Video", "Weapon", "Biological", "Digital", "Physical", "Other"];
const officerRanks = ["sp", "dsp", "inspector", "si", "asi", "head_constable", "constable"];
const accountStatuses = ["active", "inactive"];
const sortFields = {
    cases: { createdAt: "createdAt", updatedAt: "updatedAt", caseNo: "caseNo", title: "title" },
    firs: { date: "date", createdAt: "createdAt", firNo: "firNo" },
    criminals: { createdAt: "createdAt", fullName: "fullName", criminalId: "criminalId" },
    officers: { createdAt: "createdAt", name: "name", officerId: "officerId", rank: "rank" },
    evidence: { collectionDate: "collectionDate", createdAt: "createdAt", evidenceId: "evidenceId" },
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (value) => (typeof value === "string" ? value.trim() : "");
const regex = (value) => new RegExp(escapeRegex(text(value)), "i");

const parseDate = (value, field, endOfDay = false) => {
    if (value === undefined || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { error: `INVALID_${field.toUpperCase()}` };
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
        ? { error: `INVALID_${field.toUpperCase()}` }
        : date;
};

const objectId = (value, field) => {
    if (value === undefined || value === "") return null;
    return mongoose.Types.ObjectId.isValid(value)
        ? new mongoose.Types.ObjectId(value)
        : { error: `INVALID_${field.toUpperCase()}` };
};

const range = (from, to, field) => {
    const start = parseDate(from, `${field}From`);
    const end = parseDate(to, `${field}To`, true);
    if (start?.error) return start;
    if (end?.error) return end;
    if (start && end && start > end) return { error: `INVALID_${field}_RANGE` };
    if (!start && !end) return null;
    return { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
};

const common = (query, category) => {
    const filter = {};
    const keyword = text(query.keyword);
    if (keyword) {
        const value = regex(keyword);
        if (category === "cases") filter.$or = [{ caseNo: value }, { title: value }, { description: value }];
        if (category === "firs") filter.$or = [{ firNo: value }, { policeStation: value }, { description: value }, { "complaint.complainantName": value }, { crimeType: value }];
        if (category === "criminals") filter.$or = [{ criminalId: value }, { fullName: value }];
        if (category === "officers") filter.$or = [{ name: value }, { officerId: value }, { badgeNumber: value }, { station: value }];
        if (category === "evidence") filter.$or = [{ evidenceId: value }, { type: value }, { fileName: value }, { description: value }];
    }
    return filter;
};

const categoryFilter = (query, category) => {
    const filter = common(query, category);
    const allowedStatuses = statuses[category];
    if (query.status !== undefined && (!allowedStatuses || !allowedStatuses.includes(query.status))) {
        return { error: `INVALID_${category.toUpperCase()}_STATUS` };
    }
    if (query.status) filter.status = query.status;
    if (category === "cases") {
        if (query.priority !== undefined && !priorities.includes(query.priority)) return { error: "INVALID_CASE_PRIORITY" };
        if (query.priority) filter.priority = query.priority;
        const assignedOfficerId = objectId(query.assignedOfficerId, "assignedOfficerId");
        if (assignedOfficerId?.error) return assignedOfficerId;
        if (assignedOfficerId) filter.assignedOfficerIds = assignedOfficerId;
        const created = range(query.createdFrom, query.createdTo, "created");
        const updated = range(query.updatedFrom, query.updatedTo, "updated");
        if (created?.error) return created;
        if (updated?.error) return updated;
        if (created) filter.createdAt = created;
        if (updated) filter.updatedAt = updated;
    }
    if (category === "firs") {
        if (query.crimeType !== undefined && text(query.crimeType) === "") return { error: "INVALID_CRIME_TYPE" };
        if (query.crimeType) filter.crimeType = query.crimeType;
        if (query.policeStation) filter.policeStation = regex(query.policeStation);
        const dates = range(query.dateFrom, query.dateTo, "date");
        if (dates?.error) return dates;
        if (dates) filter.date = dates;
    }
    if (category === "criminals") {
        if (query.status && !statuses.criminals.includes(query.status)) return { error: "INVALID_CRIMINAL_STATUS" };
    }
    if (category === "officers") {
        if (query.rank !== undefined && !officerRanks.includes(query.rank)) return { error: "INVALID_OFFICER_RANK" };
        if (query.rank) filter.rank = query.rank;
        if (query.station) filter.station = regex(query.station);
        if (query.accountStatus !== undefined && !accountStatuses.includes(query.accountStatus)) return { error: "INVALID_ACCOUNT_STATUS" };
    }
    if (category === "evidence") {
        if (query.type !== undefined && !evidenceTypes.includes(query.type)) return { error: "INVALID_EVIDENCE_TYPE" };
        if (query.type) filter.type = query.type;
        if (query.verificationStatus && !["unverified", "verified", "rejected"].includes(query.verificationStatus)) return { error: "INVALID_VERIFICATION_STATUS" };
        if (query.verificationStatus) filter.verificationStatus = query.verificationStatus;
        const caseId = objectId(query.caseId, "caseId");
        if (caseId?.error) return caseId;
        if (caseId) filter.caseId = caseId;
        const dates = range(query.uploadedFrom, query.uploadedTo, "uploaded");
        if (dates?.error) return dates;
        if (dates) filter.uploadedAt = dates;
    }
    return filter;
};

const authorizedFilter = async (req, category, filter) => {
    const isSenior = isSeniorOfficerRank(req.authority?.rank);
    if (category === "cases" && !isSenior && req.authority?.systemRole !== "system_admin") {
        return intersectFilters(filter, { assignedOfficerIds: req.authority.officer._id });
    }
    if (category === "firs" && !isSenior && req.authority?.systemRole !== "system_admin") {
        return intersectFilters(filter, { registeredBy: req.authority.officer._id });
    }
    if (category === "evidence" && !isSenior && req.authority?.systemRole !== "system_admin") {
        const assignedCases = await Case.find({ assignedOfficerIds: req.authority.officer._id }).select("_id").lean();
        return intersectFilters(filter, { caseId: { $in: assignedCases.map((record) => record._id) } });
    }
    if (category === "officers") {
        const canSearch = req.authority?.systemRole === "system_admin" ||
            OFFICER_MANAGEMENT_RANKS.includes(req.authority?.managementRank);
        if (!canSearch) return { error: "OFFICER_SEARCH_FORBIDDEN", forbidden: true };
        if (req.authority?.systemRole !== "system_admin") {
            const subordinateIds = await Officer.find({}).select("_id userId rank").populate("userId", "role").lean();
            const manageableIds = subordinateIds
                .filter((record) => record.userId?.role === "officer" && record._id.toString() !== req.authority.officer._id.toString())
                .filter((record) => canManageOfficerRank(req.authority.managementRank, record.rank))
                .map((record) => record._id);
            filter._id = { $in: manageableIds };
        }
    }
    if (category === "officers" && req.query.accountStatus) {
        const allUsers = await User.find({ role: "officer" }).select("_id isActive").lean();
        const activeUserIds = allUsers.filter((user) => user.isActive).map((user) => user._id);
        const inactiveUserIds = allUsers.filter((user) => !user.isActive).map((user) => user._id);
        const accountFilter = req.query.accountStatus === "active"
            ? { status: "active", userId: { $in: activeUserIds } }
            : {
                userId: { $in: allUsers.map((user) => user._id) },
                $or: [{ status: { $ne: "active" } }, { userId: { $in: inactiveUserIds } }],
            };
        return intersectFilters(filter, accountFilter);
    }
    return filter;
};

const project = {
    cases: "-__v -description -investigationNotes -criminalIds -investigationHistory",
    firs: "-__v -complaint.complaintText -location.address -location.pincode",
    criminals: "criminalId fullName gender status createdAt updatedAt",
    officers: "officerId badgeNumber name rank department station status createdAt updatedAt",
    evidence: "evidenceId caseId type description fileName collectionDate uploadedAt status verificationStatus createdAt updatedAt",
};

const populate = (query, category) => {
    if (category === "cases") return query.populate("firId", "firNo").populate("assignedOfficerIds", "officerId name rank");
    if (category === "firs") return query.populate("registeredBy", "officerId name rank");
    if (category === "evidence") return query.populate("caseId", "caseNo title status");
    return query;
};

const models = { cases: Case, firs: FIR, criminals: Criminal, officers: Officer, evidence: Evidence };

const intersectFilters = (...filters) => {
    const present = filters.filter((filter) => filter && Object.keys(filter).length);
    if (present.length === 0) return {};
    if (present.length === 1) return present[0];
    return { $and: present };
};

const searchCategory = async (req, category, page, limit) => {
    const built = categoryFilter(req.query, category);
    if (built.error) return built;
    const filter = await authorizedFilter(req, category, built);
    if (filter.error) return filter;
    const sortField = sortFields[category][req.query.sortBy || Object.keys(sortFields[category])[0]];
    if (!sortField || !["asc", "desc"].includes(req.query.sortDirection || "desc")) {
        return { error: "INVALID_SORT" };
    }
    const sort = { [sortField]: req.query.sortDirection === "asc" ? 1 : -1 };
    const Model = models[category];
    const totalRecords = await Model.countDocuments(filter);
    let query = Model.find(filter).select(project[category]).sort(sort).skip((page - 1) * limit).limit(limit).lean();
    query = populate(query, category);
    const records = await query;
    return {
        category,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        page,
        limit,
        data: records.map((record) => ({ category, ...record })),
    };
};

const search = async (req, res) => {
    try {
        const unknownField = Object.keys(req.query).find((field) => !allowedQueryFields.has(field));
        if (unknownField) return invalid(res, `Unsupported search parameter: ${unknownField}`, "INVALID_SEARCH_PARAMETER");
        const category = text(req.query.category || "all").toLowerCase();
        if (category !== "all" && !categories.includes(category)) return invalid(res, "Unsupported search category", "INVALID_CATEGORY");
        const page = Number.parseInt(req.query.page || "1", 10);
        const limit = Number.parseInt(req.query.limit || "20", 10);
        if (!Number.isInteger(page) || page < 1) return invalid(res, "page must be a positive integer", "INVALID_PAGE");
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid(res, "limit must be between 1 and 50", "INVALID_LIMIT");
        const selected = category === "all" ? categories.filter((item) => item !== "officers" || req.authority?.systemRole === "system_admin" || OFFICER_MANAGEMENT_RANKS.includes(req.authority?.managementRank)) : [category];
        const results = [];
        for (const item of selected) {
            const result = await searchCategory(req, item, page, limit);
            if (result.error) {
                if (result.forbidden) {
                    return res.status(403).json({
                        success: false,
                        message: "You do not have permission to search officer records",
                        error: result.error,
                    });
                }
                return invalid(res, "Invalid search filter", result.error);
            }
            results.push(result);
        }
        return res.status(200).json({
            success: true,
            category,
            ...(category === "all" ? {} : { totalRecords: results[0]?.totalRecords || 0 }),
            pagination: results.map(({ category: resultCategory, page: resultPage, limit: resultLimit, totalRecords, totalPages }) => ({
                category: resultCategory,
                page: resultPage,
                limit: resultLimit,
                totalRecords,
                totalPages,
            })),
            results,
            data: results.flatMap((result) => result.data),
        });
    } catch (error) {
        return handleError(res, error, "Search records error");
    }
};

module.exports = { search };
