import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getRank, seniorOfficerRanks, isSeniorOfficer } from '../authority'
import { downloadEvidence, getCaseById, getCaseHistory, getEvidence, reopenCase, updateCaseStatus, verifyEvidence } from '../services/api'

const message = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server.')
const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not available'
const displayValue = (item) => item || 'Not available'
const canManageCaseLifecycle = (user) => seniorOfficerRanks.includes(getRank(user))

function CaseDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [record, setRecord] = useState(null)
  const [evidence, setEvidence] = useState([])
  const [caseHistory, setCaseHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [evidenceError, setEvidenceError] = useState('')
  const [caseHistoryError, setCaseHistoryError] = useState('')
  const [reopening, setReopening] = useState(false)
  const [showReopenDialog, setShowReopenDialog] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenReasonError, setReopenReasonError] = useState('')
  const reopenRequestInFlight = useRef(false)
  const [rejectingEvidenceId, setRejectingEvidenceId] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')

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
      try {
        const historyResponse = await getCaseHistory(id)
        setCaseHistory(Array.isArray(historyResponse.data?.data) ? historyResponse.data.data : [])
      } catch (requestError) {
        setCaseHistory([])
        setCaseHistoryError(message(requestError, 'Case history could not be loaded.'))
      }
    } catch (requestError) {
      setError(message(requestError, 'Could not load case details.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  const openReopenDialog = () => {
    setReopenReason('')
    setReopenReasonError('')
    setActionError('')
    setShowReopenDialog(true)
  }

  const closeReopenDialog = () => {
    if (reopenRequestInFlight.current) return
    setShowReopenDialog(false)
    setReopenReason('')
    setReopenReasonError('')
  }

  const handleReopen = async (event) => {
    event.preventDefault()
    const trimmedReason = reopenReason.trim()
    if (!trimmedReason) {
      setReopenReasonError('Enter a reason for reopening this case.')
      return
    }
    if (reopenRequestInFlight.current) return

    reopenRequestInFlight.current = true
    try {
      setReopening(true)
      setActionError('')
      setReopenReasonError('')
      const response = await reopenCase(id, trimmedReason)
      if (response.data?.data) setRecord(response.data.data)
      setShowReopenDialog(false)
      setReopenReason('')
      await load()
      setNotice('Case reopened successfully.')
    } catch (requestError) {
      setActionError(message(requestError, 'Could not reopen this Case.'))
    } finally {
      reopenRequestInFlight.current = false
      setReopening(false)
    }
  }

  const handleClose = async () => {
    if (!window.confirm('Close this case? It will become read-only until reopened.')) return
    try {
      setActionError('')
      await updateCaseStatus(id, 'Closed')
      await load()
      setNotice('Case closed successfully.')
    } catch (requestError) {
      setActionError(message(requestError, 'Could not close this Case.'))
    }
  }

  const handleDownloadEvidence = async (item) => {
    try {
      const response = await downloadEvidence(item._id)
      const fileUrl = response.data?.data?.downloadUrl || response.data?.data?.fileUrl || response.data?.downloadUrl || response.data?.fileUrl
      if (!fileUrl) {
        setEvidenceError('This evidence item does not contain a downloadable file.')
        return
      }
      window.open(fileUrl, '_blank', 'noopener,noreferrer')
    } catch (requestError) {
      setEvidenceError(message(requestError, 'This evidence file could not be downloaded.'))
    }
  }

  const handleVerifyEvidence = async (item, nextStatus) => {
    if (nextStatus === 'rejected') {
      setRejectingEvidenceId(item._id)
      setRejectionReason('')
      return
    }
    try {
      const note = 'Verified by senior officer'
      await verifyEvidence(item._id, { verificationStatus: nextStatus, verificationNotes: note })
      await load()
    } catch (requestError) {
      setEvidenceError(message(requestError, 'Could not update evidence verification.'))
    }
  }

  const handleRejectEvidence = async (item, event) => {
    event.preventDefault()
    const note = rejectionReason.trim()
    if (!note) return
    try {
      await verifyEvidence(item._id, { verificationStatus: 'rejected', verificationNotes: note })
      setRejectingEvidenceId('')
      setRejectionReason('')
      await load()
    } catch (requestError) {
      setEvidenceError(message(requestError, 'Could not update evidence verification.'))
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
            {notice && <div className="alert alert-success" role="status">{notice}</div>}
            {actionError && <div className="alert alert-danger" role="alert">{actionError}</div>}
            <section className="welcome-card mb-4">
              <div><p className="eyebrow mb-1">Case record</p><h2 className="mb-1">{record.caseNo}</h2><p className="mb-0 text-secondary">{record.title}</p></div>
              <div className="d-flex gap-2">{record.status !== 'Closed' && canManageCaseLifecycle(user) && <><button className="btn btn-primary" onClick={() => navigate(`/cases/${id}/edit`)} type="button">Edit Case</button><button className="btn btn-outline-danger" onClick={handleClose} type="button">Close Case</button></>}{record.status === 'Closed' && canManageCaseLifecycle(user) && <button className="btn btn-warning" onClick={openReopenDialog} type="button">Reopen Case</button>}</div>
            </section>
            {showReopenDialog && (
              <div className="modal-backdrop show" role="presentation">
                <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="reopen-case-title">
                  <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                      <form onSubmit={handleReopen} noValidate>
                        <div className="modal-header">
                          <h2 className="modal-title fs-5" id="reopen-case-title">Reopen case</h2>
                          <button className="btn-close" type="button" aria-label="Cancel reopening" disabled={reopening} onClick={closeReopenDialog} />
                        </div>
                        <div className="modal-body">
                          <label className="form-label" htmlFor="reopen-reason">Reason for reopening</label>
                          <textarea autoFocus className={`form-control${reopenReasonError ? ' is-invalid' : ''}`} id="reopen-reason" onChange={(event) => { setReopenReason(event.target.value); setReopenReasonError('') }} aria-describedby={reopenReasonError ? 'reopen-reason-error' : undefined} aria-invalid={Boolean(reopenReasonError)} rows="3" value={reopenReason} />
                          {reopenReasonError && <div className="invalid-feedback d-block" id="reopen-reason-error" role="alert">{reopenReasonError}</div>}
                        </div>
                        <div className="modal-footer">
                          <button className="btn btn-outline-secondary" type="button" disabled={reopening} onClick={closeReopenDialog}>Cancel</button>
                          <button className="btn btn-warning" type="submit" disabled={reopening}>{reopening ? 'Reopening...' : 'Confirm Reopen'}</button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
              {evidence.length ? evidence.map((item) => (
                <div className="border rounded p-3 mb-2" key={item._id}>
                  <div className="d-flex flex-column flex-md-row justify-content-between gap-2 align-items-md-center">
                    <strong>{displayValue(item.evidenceId)} · {displayValue(item.type)}</strong>
                    <div className="d-flex gap-2 flex-wrap">
                      {item.fileUrl && <button className="btn btn-sm btn-outline-primary" onClick={() => handleDownloadEvidence(item)} type="button">Download</button>}
                      {isSeniorOfficer(user) && (
                        <>
                          <button className="btn btn-sm btn-success" disabled={item.verificationStatus === 'verified'} onClick={() => handleVerifyEvidence(item, 'verified')} type="button">Verify</button>
                          <button className="btn btn-sm btn-outline-danger" disabled={item.verificationStatus === 'rejected'} onClick={() => handleVerifyEvidence(item, 'rejected')} type="button">Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div>{displayValue(item.description)}</div>
                  <div className="small text-secondary">{displayValue(item.status)} · {date(item.collectionDate)} · Verification: {item.verificationStatus || 'unverified'}</div>
                  {item.verificationNotes && <div className="small text-secondary mt-1">Note: {item.verificationNotes}</div>}
                  {item.verifiedAt && <div className="small text-secondary">Verified on {date(item.verifiedAt)}</div>}
                  {rejectingEvidenceId === item._id && (
                    <form className="mt-3" onSubmit={(event) => handleRejectEvidence(item, event)}>
                      <label className="form-label" htmlFor={`rejection-reason-${item._id}`}>Reason for rejecting this evidence</label>
                      <textarea autoFocus className="form-control mb-2" id={`rejection-reason-${item._id}`} onChange={(event) => setRejectionReason(event.target.value)} required rows="2" value={rejectionReason} />
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-danger" type="submit">Confirm rejection</button>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => setRejectingEvidenceId('')} type="button">Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              )) : <p className="mb-0">No evidence linked to this case.</p>}
            </div>
            <div className="fir-detail-card mt-4">
              <div className="detail-section-header"><h3>Case History</h3></div>
              {caseHistoryError && <div className="alert alert-warning" role="alert">{caseHistoryError}</div>}
              {caseHistory.length ? caseHistory.map((entry) => (
                <div className="border rounded p-3 mb-2" key={entry._id || `${entry.actionType}-${entry.timestamp}`}>
                  <div className="d-flex justify-content-between gap-3 align-items-center flex-wrap">
                    <strong>{entry.actionType || 'Case event'}</strong>
                    <span className="small text-secondary">{date(entry.timestamp)}</span>
                  </div>
                  <div>{entry.description}</div>
                  {entry.performedBy?.username && <div className="small text-secondary">By {entry.performedBy.username}</div>}
                  {entry.performedByRank && <div className="small text-secondary">Role: {entry.performedByRank}</div>}
                  {entry.previousValue && <div className="small text-secondary">Previous: {JSON.stringify(entry.previousValue)}</div>}
                  {entry.newValue && <div className="small text-secondary">Updated: {JSON.stringify(entry.newValue)}</div>}
                </div>
              )) : <p className="mb-0">No case history recorded yet.</p>}
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
