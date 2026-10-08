const mongoose = require("mongoose");
const FIR = require("../models/FIR");
const Case = require("../models/Case");
const CaseHistory = require("../models/CaseHistory");
const Evidence = require("../models/Evidence");
const Officer = require("../models/Officer");
const Report = require("../models/Report");
const { canManageOfficerRank } = require("../middleware/authority");

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
const crimeStatisticFilters = new Set(["fromDate", "toDate", "crimeType", "status", "city", "state", "pincode"]);
const scalar = (value) => typeof value === "string" && value.trim().length > 0;

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
    for (const field of ["city", "state", "pincode"]) {
        if (query[field] !== undefined) filter[`location.${field}`] = query[field].trim();
    }
    if (authority.rank === "investigating_officer") filter.registeredBy = authority.officer._id;

    const [result] = await FIR.aggregate([
        { $match: filter },
        {
            $facet: {
                total: [{ $count: "count" }],
                crimeTypeStats: [{ $group: { _id: "$crimeType", count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
                statusStats: [{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
                locationStats: [{ $group: { _id: { city: "$location.city", state: "$location.state" }, count: { $sum: 1 } } }, { $sort: { "_id.state": 1, "_id.city": 1 } }],
                dateStats: [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "UTC" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
            },
        },
    ]);

    return {
        totalFirs: result.total[0]?.count || 0,
        crimeTypeStats: result.crimeTypeStats.map(({ _id, count }) => ({ crimeType: _id, count })),
        statusStats: result.statusStats.map(({ _id, count }) => ({ status: _id, count })),
        locationStats: result.locationStats.map(({ _id, count }) => ({ city: _id.city, state: _id.state, count })),
        dateStats: result.dateStats.map(({ _id, count }) => ({ date: _id, count })),
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
    const isInvestigatingOfficer = authority.rank === "investigating_officer";
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
