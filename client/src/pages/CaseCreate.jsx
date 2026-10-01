import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import CaseForm from './CaseForm'
import { createCase, getAssignableOfficers, getCriminals, getFIRs } from '../services/api'

const initialForm = { caseNo: '', title: '', description: '', startDate: '', status: 'Open', priority: 'Medium', investigationNotes: '', firId: '', assignedOfficerIds: [], criminalIds: [] }
const message = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server.')

function CaseCreate() {
  const { logout } = useAuth(); const navigate = useNavigate(); const [options, setOptions] = useState({ firs: [], officers: [], criminals: [] }); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  useEffect(() => { Promise.all([getFIRs({ limit: 100 }), getAssignableOfficers(), getCriminals({ limit: 100 })]).then(([firResponse, officerResponse, criminalResponse]) => setOptions({ firs: firResponse.data?.data || [], officers: officerResponse.data?.data || [], criminals: criminalResponse.data?.data || [] })).catch((requestError) => setError(message(requestError, 'Unable to load Case form options.'))).finally(() => setLoading(false)) }, [])
  const submit = async (form, setFormError) => { try { setSaving(true); await createCase(form); navigate('/cases') } catch (requestError) { setFormError(message(requestError, 'Unable to create case.')) } finally { setSaving(false) } }
  return <div className="dashboard-page"><header className="dashboard-header"><div className="container d-flex align-items-center justify-content-between gap-3 py-3"><div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Create Case</h1></div><div className="d-flex gap-2"><button className="btn btn-outline-light" onClick={() => navigate('/cases')} type="button">Back to cases</button><button className="btn btn-outline-light" onClick={() => { logout(); navigate('/login', { replace: true }) }} type="button">Log out</button></div></div></header><main className="container py-4 py-md-5"><div className="fir-form-card mx-auto" style={{ maxWidth: '980px' }}><p className="eyebrow mb-1">Case record</p><h2 className="section-title mb-3">Create case</h2>{error && <div className="alert alert-danger" role="alert">{error}</div>}{loading ? <div className="dashboard-state" role="status">Loading Case form data...</div> : <CaseForm initialForm={initialForm} firs={options.firs} officers={options.officers} criminals={options.criminals} loading={saving} submitLabel="Create Case" onSubmit={submit} onCancel={() => navigate('/cases')} />}</div></main></div>
}
export default CaseCreate
