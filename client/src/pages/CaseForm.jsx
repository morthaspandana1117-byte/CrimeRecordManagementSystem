import { useState } from 'react'
import { casePriorities, caseStatuses } from './caseConstants'

function CaseForm({ initialForm, firs, officers, criminals, loading, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const toggleValue = (field, value) => {
    setForm((current) => {
      const values = current[field] || []
      return { ...current, [field]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] }
    })
  }

  const submit = (event) => {
    event.preventDefault()
    setError('')
    if (!form.caseNo.trim() || !form.title.trim() || !form.description.trim() || !form.startDate) return setError('Case number, title, description, and start date are required.')
    if (!form.firId) return setError('Select a related FIR.')
    if (!form.assignedOfficerIds.length) return setError('Select at least one approved and active officer.')
    onSubmit(form, setError)
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <div className="row g-3">
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="caseNo">Case number</label><input className="form-control" id="caseNo" name="caseNo" onChange={updateField} required value={form.caseNo} /></div>
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="startDate">Start date</label><input className="form-control" id="startDate" name="startDate" onChange={updateField} required type="date" value={form.startDate} /></div>
        <div className="col-12"><label className="form-label" htmlFor="title">Case title</label><input className="form-control" id="title" name="title" onChange={updateField} required value={form.title} /></div>
        <div className="col-12 col-md-6"><label className="form-label" htmlFor="firId">Related FIR</label><select className="form-select" id="firId" name="firId" onChange={updateField} value={form.firId}><option value="">Select an FIR</option>{firs.map((fir) => <option key={fir._id} value={fir._id}>{fir.firNo} - {fir.policeStation || fir.crimeType || 'FIR'}</option>)}</select>{!firs.length && <small className="text-secondary">No FIR records are available.</small>}</div>
        <div className="col-12 col-md-3"><label className="form-label" htmlFor="priority">Priority</label><select className="form-select" id="priority" name="priority" onChange={updateField} value={form.priority}>{casePriorities.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="col-12 col-md-3"><label className="form-label" htmlFor="status">Status</label><select className="form-select" id="status" name="status" onChange={updateField} value={form.status}>{caseStatuses.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="col-12"><label className="form-label" htmlFor="description">Description</label><textarea className="form-control" id="description" name="description" onChange={updateField} required rows="3" value={form.description} /></div>
        <div className="col-12"><label className="form-label" htmlFor="investigationNotes">Investigation notes</label><textarea className="form-control" id="investigationNotes" name="investigationNotes" onChange={updateField} rows="3" value={form.investigationNotes} /></div>
        <div className="col-12 col-lg-6"><label className="form-label">Assigned officers</label>{officers.length ? officers.map((officer) => <button className={`btn w-100 mb-2 ${form.assignedOfficerIds.includes(officer._id) ? 'btn-primary' : 'btn-outline-secondary'}`} key={officer._id} onClick={() => toggleValue('assignedOfficerIds', officer._id)} type="button">{officer.name} ({officer.badgeNumber || officer.officerId || 'Officer'})</button>) : <div className="alert alert-warning">No approved and active officers are available for assignment.</div>}</div>
        <div className="col-12 col-lg-6"><label className="form-label">Related criminals</label>{criminals.length ? criminals.map((criminal) => <button className={`btn w-100 mb-2 ${form.criminalIds.includes(criminal._id) ? 'btn-primary' : 'btn-outline-secondary'}`} key={criminal._id} onClick={() => toggleValue('criminalIds', criminal._id)} type="button">{criminal.fullName} ({criminal.criminalId})</button>) : <div className="alert alert-info">No criminal records are available.</div>}</div>
      </div>
      <div className="d-flex justify-content-end gap-2 mt-4"><button className="btn btn-outline-secondary" disabled={loading} onClick={onCancel} type="button">Cancel</button><button className="btn btn-primary" disabled={loading || !officers.length} type="submit">{loading ? 'Saving...' : submitLabel}</button></div>
    </form>
  )
}

export default CaseForm
