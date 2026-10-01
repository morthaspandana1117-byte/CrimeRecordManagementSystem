import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { createEvidence, getAssignableOfficers, getCaseById, getCases } from '../services/api'

const evidenceTypes = ['Document', 'Photograph', 'Video', 'Weapon', 'Biological', 'Digital', 'Physical', 'Other']
const evidenceStatuses = ['Collected', 'Under Examination', 'Verified', 'Stored', 'Released', 'Disposed']
const initialForm = { evidenceId: '', caseId: '', type: 'Document', description: '', collectedBy: '', collectionDate: '', location: '', status: 'Collected', fileUrl: '' }
const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server.')

function EvidenceCreate() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const caseIdFromUrl = searchParams.get('caseId') || ''
  const [form, setForm] = useState(() => ({ ...initialForm, caseId: caseIdFromUrl }))
  const [cases, setCases] = useState([])
  const [officers, setOfficers] = useState([])
  const [lockedCase, setLockedCase] = useState(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true)
        const [casesResponse, officersResponse] = await Promise.all([
          getCases({ limit: 100 }),
          getAssignableOfficers(),
        ])
        const availableCases = Array.isArray(casesResponse.data?.data) ? casesResponse.data.data : []
        setCases(availableCases)
        setOfficers(Array.isArray(officersResponse.data?.data) ? officersResponse.data.data : [])
        if (caseIdFromUrl) {
          const caseResponse = await getCaseById(caseIdFromUrl)
          const selectedCase = caseResponse.data?.data
          if (!selectedCase) throw new Error('Related Case was not found.')
          setLockedCase(selectedCase)
          setForm((current) => ({ ...current, caseId: caseIdFromUrl }))
        }
      } catch (requestError) {
        setError(requestMessage(requestError, 'Unable to load Evidence form options.'))
      } finally {
        setLoadingOptions(false)
      }
    }
    loadOptions()
  }, [caseIdFromUrl])

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccessMessage('')
    if (!form.evidenceId.trim() || !form.caseId || !form.description.trim() || !form.collectedBy || !form.collectionDate || !form.location.trim()) {
      setError('Evidence ID, related Case, description, collector, collection date, and location are required.')
      return
    }
    try {
      setSaving(true)
      await createEvidence({ ...form, evidenceId: form.evidenceId.trim(), description: form.description.trim(), location: form.location.trim(), fileUrl: form.fileUrl.trim() || undefined })
      setSuccessMessage('Evidence created successfully.')
      window.setTimeout(() => navigate(caseIdFromUrl ? `/cases/${caseIdFromUrl}` : '/cases'), 500)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to create Evidence.'))
    } finally {
      setSaving(false)
    }
  }

  const cancelPath = caseIdFromUrl ? `/cases/${caseIdFromUrl}` : '/cases'
  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Create Evidence</h1></div>
          <div className="d-flex gap-2"><button className="btn btn-outline-light" onClick={() => navigate(cancelPath)} type="button">Cancel</button><button className="btn btn-outline-light" onClick={() => { logout(); navigate('/login', { replace: true }) }} type="button">Log out</button></div>
        </div>
      </header>
      <main className="container py-4 py-md-5">
        <div className="fir-form-card mx-auto" style={{ maxWidth: '980px' }}>
          <p className="eyebrow mb-1">Evidence record</p><h2 className="section-title mb-3">Add Evidence</h2>
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {successMessage && <div className="alert alert-success" role="status">{successMessage}</div>}
          {loadingOptions ? <div className="dashboard-state" role="status">Loading Evidence form data...</div> : (
            <form onSubmit={submit} noValidate>
              <div className="row g-3">
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="evidenceId">Evidence ID</label><input className="form-control" id="evidenceId" name="evidenceId" onChange={updateField} required value={form.evidenceId} /></div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="caseId">Related Case</label>{lockedCase ? <input className="form-control" id="caseId" readOnly value={`${lockedCase.caseNo} - ${lockedCase.title || 'Case'}`} /> : <select className="form-select" id="caseId" name="caseId" onChange={updateField} required value={form.caseId}><option value="">Select a Case</option>{cases.map((record) => <option key={record._id} value={record._id}>{record.caseNo} - {record.title || 'Case'}</option>)}</select>}</div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="type">Evidence Type</label><select className="form-select" id="type" name="type" onChange={updateField} value={form.type}>{evidenceTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="collectedBy">Collected By</label><select className="form-select" id="collectedBy" name="collectedBy" onChange={updateField} required value={form.collectedBy}><option value="">Select an eligible officer</option>{officers.map((officer) => <option key={officer._id} value={officer._id}>{officer.name} ({officer.badgeNumber || officer.officerId || 'Officer'})</option>)}</select>{!officers.length && <small className="text-secondary">No eligible officers are available.</small>}</div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="collectionDate">Collection Date</label><input className="form-control" id="collectionDate" name="collectionDate" onChange={updateField} required type="date" value={form.collectionDate} /></div>
                <div className="col-12 col-md-6"><label className="form-label" htmlFor="status">Evidence Status</label><select className="form-select" id="status" name="status" onChange={updateField} value={form.status}>{evidenceStatuses.map((status) => <option key={status}>{status}</option>)}</select></div>
                <div className="col-12"><label className="form-label" htmlFor="location">Collection Location</label><input className="form-control" id="location" name="location" onChange={updateField} required value={form.location} /></div>
                <div className="col-12"><label className="form-label" htmlFor="description">Description</label><textarea className="form-control" id="description" name="description" onChange={updateField} required rows="3" value={form.description} /></div>
                <div className="col-12"><label className="form-label" htmlFor="fileUrl">File URL</label><input className="form-control" id="fileUrl" name="fileUrl" onChange={updateField} placeholder="https://example.com/evidence.jpg" type="url" value={form.fileUrl} /></div>
              </div>
              <div className="d-flex justify-content-end gap-2 mt-4"><button className="btn btn-outline-secondary" disabled={saving} onClick={() => navigate(cancelPath)} type="button">Cancel</button><button className="btn btn-primary" disabled={saving || !officers.length} type="submit">{saving ? 'Creating...' : 'Add Evidence'}</button></div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

export default EvidenceCreate
