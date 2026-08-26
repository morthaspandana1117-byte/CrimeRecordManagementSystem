const Case = require("../models/Case");
const FIR = require("../models/FIR");
const Officer = require("../models/Officer");
const Criminal = require("../models/Criminal");
const { isValidObjectId, isNonEmptyString, isValidDate, invalid, notFound, conflict, validateReference, validateReferences, handleError } = require("./controllerUtils");

const fields = ["caseNo", "firId", "assignedOfficerIds", "criminalIds", "title", "description", "startDate", "status", "priority", "investigationNotes"];
const required = ["caseNo", "firId", "assignedOfficerIds", "criminalIds", "title", "description", "startDate", "status", "priority"];
const populate = (query) => query.populate("firId", "firNo date policeStation crimeType status").populate("assignedOfficerIds", "officerId name rank department station status").populate("criminalIds", "criminalId fullName status");

const validateCase = async (res, body, partial = false) => {
    if (!partial && required.some((field) => body[field] === undefined || body[field] === null || body[field] === "")) return "All required case fields must be provided";
    if ((!partial || body.title !== undefined) && !isNonEmptyString(body.title)) return "title must not be empty";
    if ((!partial || body.description !== undefined) && !isNonEmptyString(body.description)) return "description must not be empty";
    if ((!partial || body.startDate !== undefined) && !isValidDate(body.startDate)) return "startDate must be a valid date";
    if (body.firId !== undefined && !await validateReference(res, FIR, body.firId, "firId")) return null;
    if (body.assignedOfficerIds !== undefined && !await validateReferences(res, Officer, body.assignedOfficerIds, "assignedOfficerIds")) return null;
    if (body.criminalIds !== undefined && !await validateReferences(res, Criminal, body.criminalIds, "criminalIds")) return null;
    return "OK";
};

const createCase = async (req, res) => {
    try {
        const result = await validateCase(res, req.body);
        if (result !== "OK") return result ? invalid(res, result) : undefined;
        if (await Case.exists({ firId: req.body.firId })) return conflict(res, "A case already exists for this FIR", "FIR_CASE_ALREADY_EXISTS");
        const record = await Case.create(req.body);
        await record.populate([
            { path: "firId", select: "firNo date policeStation crimeType status" },
            { path: "assignedOfficerIds", select: "officerId name rank department station status" },
            { path: "criminalIds", select: "criminalId fullName status" }
        ]);
        return res.status(201).json({ success: true, message: "Case created successfully", data: record });
    } catch (error) { return handleError(res, error, "Create case error"); }
};
const getAllCases = async (req, res) => { try { const filter = {}; if (req.query.status) filter.status = req.query.status; if (req.query.priority) filter.priority = req.query.priority; const records = await populate(Case.find(filter).select("-__v").sort({ createdAt: -1 })); return res.status(200).json({ success: true, count: records.length, data: records }); } catch (error) { return handleError(res, error, "Get cases error"); } };
const getCaseById = async (req, res) => { try { if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid case ID", "INVALID_CASE_ID"); const record = await populate(Case.findById(req.params.id).select("-__v")); return record ? res.status(200).json({ success: true, data: record }) : notFound(res, "Case"); } catch (error) { return handleError(res, error, "Get case error"); } };
const updateCase = async (req, res) => { try { if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid case ID", "INVALID_CASE_ID"); const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => fields.includes(key))); if (!Object.keys(updates).length) return invalid(res, "No valid case fields were provided"); const result = await validateCase(res, updates, true); if (result !== "OK") return result ? invalid(res, result) : undefined; if (updates.firId && await Case.exists({ firId: updates.firId, _id: { $ne: req.params.id } })) return conflict(res, "A case already exists for this FIR", "FIR_CASE_ALREADY_EXISTS"); const record = await populate(Case.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select("-__v")); return record ? res.status(200).json({ success: true, message: "Case updated successfully", data: record }) : notFound(res, "Case"); } catch (error) { return handleError(res, error, "Update case error"); } };
const deleteCase = async (req, res) => { try { if (!isValidObjectId(req.params.id)) return invalid(res, "Invalid case ID", "INVALID_CASE_ID"); const record = await Case.findByIdAndDelete(req.params.id); return record ? res.status(200).json({ success: true, message: "Case deleted successfully", data: { id: record._id } }) : notFound(res, "Case"); } catch (error) { return handleError(res, error, "Delete case error"); } };
module.exports = { createCase, getAllCases, getCaseById, updateCase, deleteCase };
