import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { isSeniorOfficer } from '../authority'
import { getCaseById, getEvidence, reopenCase } from '../services/api'

const message = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server.')
const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not available'
const displayValue = (item) => item || 'Not available'

function CaseDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [record, setRecord] = useState(null)
  const [evidence, setEvidence] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [evidenceError, setEvidenceError] = useState('')
  const [reopening, setReopening] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setEvidenceError('')
      const caseResponse = await getCaseById(id)
      setRecord(caseResponse.data?.data || null)
      try {
        const evidenceResponse = await getEvidence({ caseId: id })
        setEvidence(Array.isArray(evidenceResponse.data?.data) ? evidenceResponse.data.data : [])
      } catch (requestError) {
        setEvidence([])
        setEvidenceError(message(requestError, 'Related evidence could not be loaded.'))
      }
    } catch (requestError) {
      setError(message(requestError, 'Could not load case details.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  const handleReopen = async () => {
    const reopenReason = window.prompt('Reason for reopening this Case:')?.trim()
    if (!reopenReason) return
    try {
      setReopening(true)
      await reopenCase(id, reopenReason)
      await load()
    } catch (requestError) {
      setError(message(requestError, 'Could not reopen this Case.'))
    } finally {
      setReopening(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  if (loading) {
    return <main className="page-loader" aria-label="Loading case"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Loading case details...</span></main>
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Case Details</h1></div>
          <button className="btn btn-outline-light" onClick={() => navigate('/cases')} type="button">Back to cases</button>
        </div>
      </header>
      <main className="container py-4 py-md-5">
        {error || !record ? (
          <><div className="alert alert-danger" role="alert">{error || 'Case not found.'}</div><button className="btn btn-primary" onClick={load} type="button">Retry</button></>
        ) : (
          <>
            <section className="welcome-card mb-4">
              <div><p className="eyebrow mb-1">Case record</p><h2 className="mb-1">{record.caseNo}</h2><p className="mb-0 text-secondary">{record.title}</p></div>
              <div className="d-flex gap-2">{isSeniorOfficer(user) && <button className="btn btn-primary" onClick={() => navigate(`/cases/${id}/edit`)} type="button">Edit Case</button>}{record.status === 'Closed' && isSeniorOfficer(user) && <button className="btn btn-warning" disabled={reopening} onClick={handleReopen} type="button">{reopening ? 'Reopening...' : 'Reopen Case'}</button>}</div>
            </section>
            <div className="row g-4">
              <div className="col-12 col-lg-8">
                <div className="fir-detail-card">
                  <div className="detail-section-header"><h3>Case Information</h3></div>
                  <div className="row g-3">
                    <Info label="Case number" text={record.caseNo} /><Info label="Title" text={record.title} /><Info label="Start date" text={date(record.startDate)} /><Info label="Priority" text={record.priority} /><Info label="Status" text={record.status} /><Info label="Related FIR" text={record.firId?.firNo} /><Info label="Description" text={record.description} /><Info label="Investigation notes" text={record.investigationNotes} />
                  </div>
                </div>
              </div>
              <div className="col-12 col-lg-4">
                <div className="fir-detail-card mb-4"><div className="detail-section-header"><h3>Assigned Officers</h3></div>{record.assignedOfficerIds?.length ? record.assignedOfficerIds.map((officer) => <div className="border rounded p-3 mb-2" key={officer._id}><strong>{displayValue(officer.name)}</strong><div className="small text-secondary">{displayValue(officer.officerId)} · {displayValue(officer.rank)}</div></div>) : <p className="mb-0">No officers assigned.</p>}</div>
                <div className="fir-detail-card"><div className="detail-section-header"><h3>Related Criminals</h3></div>{record.criminalIds?.length ? record.criminalIds.map((criminal) => <div className="border rounded p-3 mb-2" key={criminal._id}><strong>{displayValue(criminal.fullName)}</strong><div className="small text-secondary">{displayValue(criminal.criminalId)} · {displayValue(criminal.status)}</div></div>) : <p className="mb-0">No criminals linked.</p>}</div>
              </div>
            </div>
            <div className="fir-detail-card mt-4">
              <div className="detail-section-header d-flex align-items-center justify-content-between gap-3"><h3>Related Evidence</h3>{record.status !== 'Closed' && <button className="btn btn-sm btn-primary" onClick={() => navigate(`/evidence/create?caseId=${id}`)} type="button">+ Add Evidence</button>}</div>
              {evidenceError && <div className="alert alert-warning" role="alert">{evidenceError}</div>}
              {evidence.length ? evidence.map((item) => <div className="border rounded p-3 mb-2" key={item._id}><strong>{displayValue(item.evidenceId)} · {displayValue(item.type)}</strong><div>{displayValue(item.description)}</div><div className="small text-secondary">{displayValue(item.status)} · {date(item.collectionDate)}</div></div>) : <p className="mb-0">No evidence linked to this case.</p>}
            </div>
            {record.investigationHistory?.length > 0 && <div className="fir-detail-card mt-4"><div className="detail-section-header"><h3>Investigation History</h3></div>{record.investigationHistory.map((round) => { const roundEvidence = evidence.filter((item) => item.investigationRound === round.round); return <div className="border rounded p-3 mb-3" key={round.round}><strong>Investigation Round {round.round}</strong><div className="small text-secondary">Started: {date(round.startedAt)} · Closed: {date(round.closedAt)} · {displayValue(round.status)}</div>{round.reopenReason && <div>Reason: {round.reopenReason}</div>}<div className="mt-2">{roundEvidence.length ? roundEvidence.map((item) => <div key={item._id}>{item.evidenceId} · {item.type}</div>) : 'No evidence recorded in this round.'}</div></div> })}</div>}
          </>
        )}
      </main>
    </div>
  )
}

function Info({ label, text }) {
  return <div className="col-12 col-md-6"><div className="detail-value-block"><span className="detail-label">{label}</span><strong>{displayValue(text)}</strong></div></div>
}

export default CaseDetails
