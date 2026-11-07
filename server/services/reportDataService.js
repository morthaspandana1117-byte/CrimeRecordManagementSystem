const mongoose = require("mongoose");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const CaseHistory = require("../models/CaseHistory");
const Evidence = require("../models/Evidence");
const Officer = require("../models/Officer");
const Report = require("../models/Report");
const { canManageOfficerRank, isSeniorOfficerRank } = require("../middleware/authority");

class ReportDataError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const invalid = (message, code = "INVALID_REQUEST") => {
    throw new ReportDataError(400, message, code);
};

const crimeTypes = [
    "Theft", "Robbery", "Murder", "Assault", "Kidnapping", "Fraud",
    "Cyber Crime", "Drug Offense", "Sexual Offense", "Property Crime", "Other",
];
const firStatuses = ["Open", "Registered", "Under Investigation", "Charge Sheet Filed", "Closed"];
const caseStatuses = ["Open", "Under Investigation", "Court Proceedings", "Closed", "Reopened"];
const crimeStatisticFilters = new Set(["fromDate", "toDate", "crimeType", "status", "caseStatus", "city", "state", "pincode", "policeStation"]);
const scalar = (value) => typeof value === "string" && value.trim().length > 0;
const safeDate = (field) => ({
    $convert: { input: field, to: "date", onError: null, onNull: null },
});

const parseCalendarDate = (value) => {
    if (!scalar(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const getCrimeStatisticsData = async (query, authority) => {
    const keys = Object.keys(query);
    if (keys.some((key) => !crimeStatisticFilters.has(key)) || keys.some((key) => !scalar(query[key]))) {
        invalid("Unsupported or malformed crime statistics filter", "INVALID_FILTER");
    }

    const filter = {};
    let fromDate;
    let toDate;
    if (query.fromDate !== undefined) {
        fromDate = parseCalendarDate(query.fromDate);
        if (!fromDate) invalid("fromDate must be a valid ISO date", "INVALID_FROM_DATE");
    }
    if (query.toDate !== undefined) {
        toDate = parseCalendarDate(query.toDate);
        if (!toDate) invalid("toDate must be a valid ISO date", "INVALID_TO_DATE");
    }
    if (fromDate && toDate && fromDate > toDate) {
        invalid("fromDate must be on or before toDate", "INVALID_DATE_RANGE");
    }
    if (fromDate || toDate) {
        filter.date = {};
        if (fromDate) filter.date.$gte = fromDate;
        if (toDate) {
            const exclusiveEnd = new Date(toDate);
            exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
            filter.date.$lt = exclusiveEnd;
        }
    }
    if (query.crimeType !== undefined) {
        if (!crimeTypes.includes(query.crimeType)) invalid("Unsupported crimeType", "INVALID_CRIME_TYPE");
        filter.crimeType = query.crimeType;
    }
    if (query.status !== undefined) {
        if (!firStatuses.includes(query.status)) invalid("Unsupported FIR status", "INVALID_FIR_STATUS");
        filter.status = query.status;
    }
    if (query.caseStatus !== undefined && !caseStatuses.includes(query.caseStatus)) {
        invalid("Unsupported case status", "INVALID_CASE_STATUS");
    }
    for (const field of ["city", "state", "pincode"]) {
        if (query[field] !== undefined) filter[`location.${field}`] = query[field].trim();
    }
    if (query.policeStation !== undefined) filter.policeStation = query.policeStation.trim();
    if (!isSeniorOfficerRank(authority.rank)) filter.registeredBy = authority.officer._id;

    const firPipeline = [
        { $match: filter },
        ...(query.caseStatus !== undefined ? [
            {
                $lookup: {
                    from: Case.collection.name,
                    let: { matchedFirId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$firId", "$$matchedFirId"] } } },
                        { $project: { _id: 0, status: 1 } },
                    ],
                    as: "caseRecord",
                },
            },
            { $match: { "caseRecord.status": query.caseStatus } },
        ] : []),
        {
            $facet: {
                total: [{ $count: "count" }],
                crimeTypeStats: [{ $group: { _id: "$crimeType", count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
                statusStats: [{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
                locationStats: [{ $group: { _id: { city: "$location.city", state: "$location.state" }, count: { $sum: 1 } } }, { $sort: { "_id.state": 1, "_id.city": 1 } }],
                dateStats: [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: safeDate("$date"), timezone: "UTC", onNull: "Unknown" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
            },
        },
    ];

    const caseMatch = {};
    if (query.caseStatus !== undefined) caseMatch.status = query.caseStatus;
    if (fromDate || toDate) {
        caseMatch.startDate = {};
        if (fromDate) caseMatch.startDate.$gte = fromDate;
        if (toDate) {
            const exclusiveEnd = new Date(toDate);
            exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
            caseMatch.startDate.$lt = exclusiveEnd;
        }
    }

    const linkedFirMatch = {};
    if (query.crimeType !== undefined) linkedFirMatch["fir.crimeType"] = query.crimeType;
    if (query.status !== undefined) linkedFirMatch["fir.status"] = query.status;
    for (const field of ["city", "state", "pincode"]) {
        if (query[field] !== undefined) linkedFirMatch[`fir.location.${field}`] = query[field].trim();
    }
    if (query.policeStation !== undefined) linkedFirMatch["fir.policeStation"] = query.policeStation.trim();
    if (!isSeniorOfficerRank(authority.rank)) linkedFirMatch["fir.registeredBy"] = authority.officer._id;

    const casePipeline = [
        { $match: caseMatch },
        {
            $lookup: {
                from: FIR.collection.name,
                let: { linkedFirId: "$firId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$linkedFirId"] } } },
                    { $project: { crimeType: 1, status: 1, policeStation: 1, "location.city": 1, "location.state": 1, "location.pincode": 1, registeredBy: 1 } },
                ],
                as: "fir",
            },
        },
        { $unwind: { path: "$fir", preserveNullAndEmptyArrays: true } },
        ...(Object.keys(linkedFirMatch).length ? [{ $match: linkedFirMatch }] : []),
        {
            $addFields: {
                _statCity: { $trim: { input: { $ifNull: ["$fir.location.city", ""] } } },
                _statState: { $trim: { input: { $ifNull: ["$fir.location.state", ""] } } },
                _statPoliceStation: { $trim: { input: { $ifNull: ["$fir.policeStation", ""] } } },
                _statCrimeType: { $trim: { input: { $ifNull: ["$fir.crimeType", ""] } } },
            },
        },
        {
            $facet: {
                total: [{ $count: "count" }],
                statusStats: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
                monthlyStats: [
                    { $group: { _id: { $dateToString: { format: "%Y-%m", date: safeDate("$startDate"), timezone: "UTC", onNull: "Unknown" } }, count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ],
                yearlyStats: [
                    { $group: { _id: { $dateToString: { format: "%Y", date: safeDate("$startDate"), timezone: "UTC", onNull: "Unknown" } }, count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ],
                crimeTypeStats: [
                    { $group: { _id: { $cond: [{ $eq: ["$_statCrimeType", ""] }, "Unspecified", "$_statCrimeType"] }, count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ],
                stateStats: [
                    { $match: { _statState: { $ne: "" } } },
                    { $group: { _id: "$_statState", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ],
                policeStationStats: [
                    { $match: { _statPoliceStation: { $ne: "" } } },
                    { $group: { _id: "$_statPoliceStation", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ],
                locationStats: [
                    { $match: { _statState: { $ne: "" }, _statCity: { $ne: "" } } },
                    { $group: { _id: { city: "$_statCity", state: "$_statState" }, count: { $sum: 1 } } },
                    { $sort: { "_id.state": 1, "_id.city": 1 } },
                ],
                missingGeography: [
                    { $match: { $or: [{ _statState: "" }, { _statCity: "" }, { _statPoliceStation: "" }] } },
                    { $count: "count" },
                ],
            },
        },
    ];

    const [[result], [caseResult]] = await Promise.all([
        FIR.aggregate(firPipeline),
        Case.aggregate(casePipeline),
    ]);

    const caseCounts = new Map(caseResult.statusStats.map(({ _id, count }) => [_id, count]));
    const totalCases = caseResult.total[0]?.count || 0;
    const knownStatusStats = caseStatuses.map((status) => ({ status, count: caseCounts.get(status) || 0 }));
    const legacyStatusStats = caseResult.statusStats
        .filter(({ _id }) => !caseStatuses.includes(_id))
        .sort(({ _id: left }, { _id: right }) => String(left ?? "").localeCompare(String(right ?? "")))
        .map(({ _id, count }) => ({ status: _id, count }));
    const statusStats = [...knownStatusStats, ...legacyStatusStats];
    const closedCases = caseCounts.get("Closed") || 0;

    return {
        totalFirs: result.total[0]?.count || 0,
        crimeTypeStats: result.crimeTypeStats.map(({ _id, count }) => ({ crimeType: _id, count })),
        statusStats: result.statusStats.map(({ _id, count }) => ({ status: _id, count })),
        locationStats: result.locationStats.map(({ _id, count }) => ({ city: _id.city, state: _id.state, count })),
        dateStats: result.dateStats.map(({ _id, count }) => ({ date: _id, count })),
        caseStatistics: {
            totalCases,
            openCases: totalCases - closedCases,
            closedCases,
            statusStats,
            monthlyStats: caseResult.monthlyStats.map(({ _id, count }) => ({ month: _id, count })),
            yearlyStats: caseResult.yearlyStats.map(({ _id, count }) => ({ year: _id, count })),
            crimeTypeStats: caseResult.crimeTypeStats.map(({ _id, count }) => ({ crimeType: _id, count })),
            stateStats: caseResult.stateStats.map(({ _id, count }) => ({ state: _id, count })),
            policeStationStats: caseResult.policeStationStats.map(({ _id, count }) => ({ policeStation: _id, count })),
            locationStats: caseResult.locationStats.map(({ _id, count }) => ({ city: _id.city, state: _id.state, count })),
            casesWithoutCompleteLocation: caseResult.missingGeography[0]?.count || 0,
            dateBasis: "Case.startDate (UTC)",
        },
        firDateBasis: "FIR.date (UTC)",
    };
};

const parseMonthRange = (value) => {
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
    const [yearText, monthText] = value.split("-");
    const start = new Date(0);
    start.setUTCFullYear(Number(yearText), Number(monthText) - 1, 1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
};

const getMonthlyReportData = async (query, authority) => {
    if (Object.keys(query).some((key) => key !== "month")) {
        invalid("Only the month filter is supported", "INVALID_MONTHLY_REPORT_FILTER");
    }
    if (!Object.prototype.hasOwnProperty.call(query, "month")) {
        invalid("month is required in YYYY-MM format", "MONTH_REQUIRED");
    }
    const month = query.month;
    const range = parseMonthRange(month);
    if (!range) invalid("month must be a valid calendar month in YYYY-MM format", "INVALID_MONTH");

    const officerId = authority.officer._id;
    const isInvestigatingOfficer = !isSeniorOfficerRank(authority.rank);
    const dateRange = { $gte: range.start, $lt: range.end };
    const firFilter = { date: dateRange };
    const caseFilter = { startDate: dateRange };
    const reportFilter = { reportDate: dateRange, preparedBy: officerId };
    let evidenceFilter = { collectionDate: dateRange };

    if (isInvestigatingOfficer) {
        firFilter.registeredBy = officerId;
        caseFilter.assignedOfficerIds = officerId;
        const assignedCases = await Case.find({ assignedOfficerIds: officerId }).distinct("_id");
        evidenceFilter.caseId = { $in: assignedCases };
    }

    const [firs, cases, evidence, reports] = await Promise.all([
        FIR.countDocuments(firFilter),
        Case.countDocuments(caseFilter),
        Evidence.countDocuments(evidenceFilter),
        Report.countDocuments(reportFilter),
    ]);
    return { month, statistics: { firs, cases, evidence, reports } };
};

const getOfficerPerformanceData = async (query, authority) => {
    if (Object.keys(query).some((key) => key !== "officerId")) {
        invalid("Unsupported officer performance filter", "INVALID_FILTER");
    }
    const hasTargetOfficer = Object.prototype.hasOwnProperty.call(query, "officerId");
    if (hasTargetOfficer && (typeof query.officerId !== "string" || !query.officerId.trim())) {
        invalid("officerId must be a single valid officer ID", "INVALID_OFFICER_ID");
    }
    const authenticatedOfficer = authority.officer;
    const targetOfficerId = hasTargetOfficer ? query.officerId : authenticatedOfficer._id;
    if (!mongoose.Types.ObjectId.isValid(targetOfficerId)) {
        invalid("officerId must be a valid officer ID", "INVALID_OFFICER_ID");
    }
    const targetOfficer = await Officer.findById(targetOfficerId)
        .select("_id officerId name rank department station");
    if (!targetOfficer) throw new ReportDataError(404, "Officer not found", "OFFICER_NOT_FOUND");

    const isSelf = String(targetOfficer._id) === String(authenticatedOfficer._id);
    if (!isSelf && !canManageOfficerRank(authority.managementRank, targetOfficer.rank)) {
        throw new ReportDataError(
            403,
            "You may view your own performance or that of a subordinate officer",
            "OFFICER_PERFORMANCE_ACCESS_DENIED",
        );
    }

    const assignedCaseIds = await Case.find({ assignedOfficerIds: targetOfficer._id }).distinct("_id");
    const [firsRegistered, currentlyAssignedCases, evidenceForAssignedCases, reportsPrepared, closedCases] = await Promise.all([
        FIR.countDocuments({ registeredBy: targetOfficer._id }),
        Case.countDocuments({ assignedOfficerIds: targetOfficer._id }),
        Evidence.countDocuments({ caseId: { $in: assignedCaseIds } }),
        Report.countDocuments({ preparedBy: targetOfficer._id }),
        CaseHistory.aggregate([
            {
                $match: {
                    actionType: "case_status_changed",
                    performedByOfficer: targetOfficer._id,
                    "newValue.status": "Closed",
                },
            },
            { $group: { _id: "$caseId" } },
            { $count: "count" },
        ]),
    ]);

    return {
        officer: {
            officerId: targetOfficer.officerId,
            name: targetOfficer.name,
            rank: targetOfficer.rank,
            department: targetOfficer.department,
            station: targetOfficer.station,
        },
        metrics: {
            firsRegistered,
            currentlyAssignedCases,
            distinctCasesClosedByOfficer: closedCases[0]?.count || 0,
            evidenceForAssignedCases,
            reportsPrepared,
        },
    };
};

module.exports = {
    ReportDataError,
    getCrimeStatisticsData,
    getMonthlyReportData,
    getOfficerPerformanceData,
};
