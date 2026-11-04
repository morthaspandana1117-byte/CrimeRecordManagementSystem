import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getRank, seniorOfficerRanks, isSeniorOfficer, canCheckEvidenceIntegrity } from '../authority'
import { acknowledgeEvidenceCustodyTransfer, checkEvidenceIntegrity, downloadEvidence, downloadEvidenceHistoryReport, getCaseById, getCaseTimeline, getEvidence, getEvidenceCustodyHistory, getEvidenceHistory, getPendingEvidenceCustodyTransfer, initiateEvidenceCustodyTransfer, reopenCase, updateCaseStatus, verifyEvidence } from '../services/api'
import { applyEvidenceVerificationResponse, evidenceHistoryDescription, evidenceHistoryItemsFromResponse, evidenceHistoryPaginationFromResponse, evidenceItemsFromResponse, evidenceReportButtonLabel, evidenceReportErrorMessage, evidenceVerificationLabel, hasPrivateEvidenceFile, integrityCheckButtonLabel, integrityCheckErrorMessage, integrityResultLabel, safeEvidenceDownloadFilename, triggerEvidenceReportDownload } from '../utils/evidenceFiles'
import { isSectionExpanded, toggleSectionId } from '../utils/collapsibleSections'
import { timelineEventActor, timelineEventTitle, timelineItemsFromResponse, timelinePaginationFromResponse } from '../utils/caseTimeline'

const message = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server.')
const date = (value) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not available'
const dateTime = (value) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available'
const displayValue = (item) => item || 'Not available'
const canManageCaseLifecycle = (user) => seniorOfficerRanks.includes(getRank(user))

function CaseDetails() {
  const { id } = useParams()
  const location = useLocation()
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
  const [evidenceReportError, setEvidenceReportError] = useState({})
  const [evidenceReportLoadingIds, setEvidenceReportLoadingIds] = useState([])
  const [custodyStates, setCustodyStates] = useState({})
  const [custodyHistories, setCustodyHistories] = useState({})
  const [custodyLoadingIds, setCustodyLoadingIds] = useState([])
  const [custodyErrors, setCustodyErrors] = useState({})
  const [custodyInputs, setCustodyInputs] = useState({})
  const [custodyActionIds, setCustodyActionIds] = useState([])
  const [expandedCustodyIds, setExpandedCustodyIds] = useState([])
  const [caseHistoryError, setCaseHistoryError] = useState('')
  const [caseHistoryExpanded, setCaseHistoryExpanded] = useState(false)
  const [timelinePagination, setTimelinePagination] = useState({ page: 1, limit: 20, totalRecords: 0, totalPages: 1 })
  const [reopening, setReopening] = useState(false)
  const [showReopenDialog, setShowReopenDialog] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenReasonError, setReopenReasonError] = useState('')
  const reopenRequestInFlight = useRef(false)
  const [rejectingEvidenceId, setRejectingEvidenceId] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [integrityResults, setIntegrityResults] = useState({})
  const [checkingIntegrityIds, setCheckingIntegrityIds] = useState([])
  const integrityChecksInFlight = useRef(new Set())
  const [expandedEvidenceHistoryIds, setExpandedEvidenceHistoryIds] = useState([])
  const [evidenceHistories, setEvidenceHistories] = useState({})
  const [evidenceHistoryPagination, setEvidenceHistoryPagination] = useState({})
  const [evidenceHistoryLoadingIds, setEvidenceHistoryLoadingIds] = useState([])
  const [evidenceHistoryErrors, setEvidenceHistoryErrors] = useState({})
  const evidenceHistoryRequests = useRef(new Set())

  const loadCustodyState = useCallback(async (evidenceId) => {
    setCustodyLoadingIds((current) => current.includes(evidenceId) ? current : [...current, evidenceId])
    setCustodyErrors((current) => ({ ...current, [evidenceId]: '' }))
    try {
      const [pendingResponse, historyResponse] = await Promise.all([
        getPendingEvidenceCustodyTransfer(evidenceId),
        getEvidenceCustodyHistory(evidenceId),
      ])
      setCustodyStates((current) => ({
        ...current,
        [evidenceId]: {
          pending: pendingResponse.data?.data || null,
          canInitiate: Boolean(pendingResponse.data?.canInitiate),
          canAcknowledge: Boolean(pendingResponse.data?.canAcknowledge),
        },
      }))
      setCustodyHistories((current) => ({ ...current, [evidenceId]: Array.isArray(historyResponse.data?.data) ? historyResponse.data.data : [] }))
    } catch (requestError) {
      setCustodyErrors((current) => ({ ...current, [evidenceId]: message(requestError, 'Custody details could not be loaded.') }))
    } finally {
      setCustodyLoadingIds((current) => current.filter((value) => value !== evidenceId))
    }
  }, [])

  const load = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) setLoading(true)
      setError('')
      setEvidenceError('')
      const caseResponse = await getCaseById(id)
      setRecord(caseResponse.data?.data || null)
      try {
        const evidenceResponse = await getEvidence({ caseId: id })
        const records = evidenceItemsFromResponse(evidenceResponse)
        setEvidence(records)
        await Promise.all(records.map((item) => loadCustodyState(String(item._id))))
      } catch (requestError) {
        setEvidence([])
        setEvidenceError(message(requestError, 'Related evidence could not be loaded.'))
      }
      try {
        const timelineResponse = await getCaseTimeline(id, { page: 1, limit: 20 })
        setCaseHistory(timelineItemsFromResponse(timelineResponse))
        setTimelinePagination(timelinePaginationFromResponse(timelineResponse))
      } catch (requestError) {
        setCaseHistory([])
        setTimelinePagination({ page: 1, limit: 20, totalRecords: 0, totalPages: 1 })
        setCaseHistoryError(message(requestError, 'Case timeline could not be loaded.'))
      }
    } catch (requestError) {
      setError(message(requestError, 'Could not load case details.'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [id, loadCustodyState])

  const loadTimelinePage = async (page) => {
    try {
      setCaseHistoryError('')
      const response = await getCaseTimeline(id, { page, limit: timelinePagination.limit })
      setCaseHistory(timelineItemsFromResponse(response))
      setTimelinePagination(timelinePaginationFromResponse(response))
    } catch (requestError) {
      setCaseHistoryError(message(requestError, 'Case timeline could not be loaded.'))
    }
  }

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
      const blobUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = safeEvidenceDownloadFilename(item.fileName, `evidence-${item.evidenceId || 'file'}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000)
    } catch {
      setEvidenceError('This evidence file could not be downloaded. It may be missing or you may not have access.')
    }
  }

  const handleDownloadEvidenceReport = async (item) => {
      if (evidenceReportLoadingIds.includes(item._id)) return
      setEvidenceReportLoadingIds((current) => [...current, item._id])
      setEvidenceReportError((current) => ({ ...current, [item._id]: '' }))
      try {
        const response = await downloadEvidenceHistoryReport(item._id)
        triggerEvidenceReportDownload(response.data, safeEvidenceDownloadFilename(`evidence-history-${item.evidenceId || 'report'}`, 'evidence-history-report') + '.pdf')
      } catch (requestError) {
        setEvidenceReportError((current) => ({ ...current, [item._id]: evidenceReportErrorMessage(requestError) || message(requestError, 'The evidence report could not be generated.') }))
      } finally {
        setEvidenceReportLoadingIds((current) => current.filter((id) => id !== item._id))
    }
  }

  const handleInitiateCustodyTransfer = async (item, event) => {
    event.preventDefault()
    const input = custodyInputs[item._id] || {}
    if (!input.toOfficerId || custodyActionIds.includes(item._id)) return
    setCustodyActionIds((current) => [...current, item._id])
    setCustodyErrors((current) => ({ ...current, [item._id]: '' }))
    try {
      await initiateEvidenceCustodyTransfer(item._id, { toOfficerId: input.toOfficerId, remarks: input.remarks || '' })
      setNotice('Custody transfer initiated. The current custodian remains unchanged until receipt is acknowledged.')
      setCustodyInputs((current) => ({ ...current, [item._id]: { toOfficerId: '', remarks: '' } }))
      await load({ showLoading: false })
    } catch (requestError) {
      setCustodyErrors((current) => ({ ...current, [item._id]: message(requestError, 'Custody transfer could not be initiated.') }))
    } finally {
      setCustodyActionIds((current) => current.filter((value) => value !== item._id))
    }
  }

  const handleAcknowledgeCustodyTransfer = async (item, transferId) => {
    if (custodyActionIds.includes(item._id)) return
    setCustodyActionIds((current) => [...current, item._id])
    setCustodyErrors((current) => ({ ...current, [item._id]: '' }))
    try {
      await acknowledgeEvidenceCustodyTransfer(item._id, transferId)
      setNotice('Receipt acknowledged. Evidence custody has been updated.')
      await load({ showLoading: false })
    } catch (requestError) {
      setCustodyErrors((current) => ({ ...current, [item._id]: message(requestError, 'Receipt could not be acknowledged.') }))
    } finally {
      setCustodyActionIds((current) => current.filter((value) => value !== item._id))
    }
  }

  const officerName = (value) => {
    const officerId = String(value?._id || value || '')
    const assigned = record?.assignedOfficerIds?.find((officer) => String(officer?._id || officer) === officerId)
    return value?.name || assigned?.name || value?.officerId || assigned?.officerId || officerId || 'Unknown officer'
  }

  const handleIntegrityCheck = async (item) => {
    if (integrityChecksInFlight.current.has(item._id)) return
    integrityChecksInFlight.current.add(item._id)
    setCheckingIntegrityIds((current) => [...current, item._id])
    setIntegrityResults((current) => ({ ...current, [item._id]: { error: '' } }))
    try {
      const response = await checkEvidenceIntegrity(item._id)
      const result = response.data?.data?.result
      if (!['intact', 'modified', 'missing'].includes(result)) throw new Error('Invalid integrity-check response')
      setIntegrityResults((current) => ({ ...current, [item._id]: { result } }))
    } catch (requestError) {
      setIntegrityResults((current) => ({ ...current, [item._id]: { error: integrityCheckErrorMessage(requestError.response?.data?.error) } }))
    } finally {
      integrityChecksInFlight.current.delete(item._id)
      setCheckingIntegrityIds((current) => current.filter((id) => id !== item._id))
    }
  }

  const handleToggleEvidenceHistory = (item) => {
    const selectedId = String(item._id)
    setExpandedEvidenceHistoryIds((current) => toggleSectionId(current, selectedId))
    if (evidenceHistoryRequests.current.has(selectedId)) return
    if (evidenceHistories[selectedId]) return
    setEvidenceHistoryPagination((current) => ({
      ...current,
      [selectedId]: { page: 1, limit: 50, totalRecords: 0, totalPages: 1 },
    }))
    void loadEvidenceHistory(selectedId, 1)
  }

  const toggleCustody = (evidenceId) => {
    setExpandedCustodyIds((current) => toggleSectionId(current, evidenceId))
  }

  const loadEvidenceHistory = async (evidenceId, page = 1) => {
    if (evidenceHistoryRequests.current.has(evidenceId)) return
    evidenceHistoryRequests.current.add(evidenceId)
    setEvidenceHistoryLoadingIds((current) => current.includes(evidenceId) ? current : [...current, evidenceId])
    setEvidenceHistoryErrors((current) => ({ ...current, [evidenceId]: '' }))
    try {
      const response = await getEvidenceHistory(evidenceId, { page, limit: 50 })
      setEvidenceHistories((current) => ({ ...current, [evidenceId]: evidenceHistoryItemsFromResponse(response) }))
      setEvidenceHistoryPagination((current) => ({ ...current, [evidenceId]: evidenceHistoryPaginationFromResponse(response) }))
    } catch (requestError) {
      setEvidenceHistoryErrors((current) => ({ ...current, [evidenceId]: message(requestError, 'Evidence history could not be loaded.') }))
    } finally {
      evidenceHistoryRequests.current.delete(evidenceId)
      setEvidenceHistoryLoadingIds((current) => current.filter((id) => id !== evidenceId))
    }
  }

  const getEvidenceHistoryPage = (evidenceId) => evidenceHistoryPagination[evidenceId] || { page: 1, limit: 50, totalRecords: 0, totalPages: 1 }

  const isEvidenceHistoryExpanded = (evidenceId) => isSectionExpanded(expandedEvidenceHistoryIds, String(evidenceId))

  const isCustodyExpanded = (evidenceId) => isSectionExpanded(expandedCustodyIds, String(evidenceId))

  const handleVerifyEvidence = async (item, nextStatus) => {
    if (nextStatus === 'rejected') {
      setRejectingEvidenceId(item._id)
      setRejectionReason('')
      return
    }
    try {
      const note = 'Verified by senior officer'
      const response = await verifyEvidence(item._id, { verificationStatus: nextStatus, verificationNotes: note })
      setEvidence((current) => current.map((record) => record._id === item._id ? applyEvidenceVerificationResponse(record, response) : record))
      await load({ showLoading: false })
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
  }, [load, location.key])

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
                      {hasPrivateEvidenceFile(item) && <button className="btn btn-sm btn-outline-primary" onClick={() => handleDownloadEvidence(item)} type="button">Download</button>}
                      <button className="btn btn-sm btn-outline-primary" disabled={evidenceReportLoadingIds.includes(item._id)} onClick={() => handleDownloadEvidenceReport(item)} type="button">{evidenceReportButtonLabel(evidenceReportLoadingIds.includes(item._id))}</button>
                      <button className="btn btn-sm btn-outline-secondary" aria-expanded={isEvidenceHistoryExpanded(item._id)} aria-controls={`evidence-history-panel-${item._id}`} onClick={() => handleToggleEvidenceHistory(item)} type="button">{isEvidenceHistoryExpanded(item._id) ? 'Hide History' : 'History'}</button>
                      {canCheckEvidenceIntegrity(user) && <button className="btn btn-sm btn-outline-info" disabled={checkingIntegrityIds.includes(item._id)} onClick={() => handleIntegrityCheck(item)} type="button">{integrityCheckButtonLabel(checkingIntegrityIds.includes(item._id))}</button>}
                      {isSeniorOfficer(user) && (
                        <>
                          <button className="btn btn-sm btn-success" disabled={item.verificationStatus === 'verified'} onClick={() => handleVerifyEvidence(item, 'verified')} type="button">{evidenceVerificationLabel(item)}</button>
                          <button className="btn btn-sm btn-outline-danger" disabled={item.verificationStatus === 'rejected'} onClick={() => handleVerifyEvidence(item, 'rejected')} type="button">Reject</button>
                        </>
                      )}
                    </div>
                    {evidenceReportError[item._id] && <div className="alert alert-warning mt-2 mb-0" role="alert">{evidenceReportError[item._id]}</div>}
                  </div>
                  <div>{displayValue(item.description)}</div>
                  <div className="small text-secondary">{displayValue(item.status)} · {date(item.collectionDate)} · Verification: {item.verificationStatus || 'unverified'}</div>
                  <div className="small mt-1" data-testid={`current-custodian-${item._id}`}>Current custodian: {officerName(item.currentCustodian || item.collectedBy)}</div>
                  <button className="btn btn-sm btn-outline-secondary mt-3" aria-expanded={isCustodyExpanded(item._id)} aria-controls={`custody-panel-${item._id}`} onClick={() => toggleCustody(String(item._id))} type="button">
                    {isCustodyExpanded(item._id) ? 'Hide Chain of Custody' : 'Chain of Custody'}
                  </button>
                  {isCustodyExpanded(item._id) && <section className="border rounded p-3 mt-2" id={`custody-panel-${item._id}`} aria-label={`Custody for evidence ${item.evidenceId}`}>
                    <h4 className="h6">Chain of custody</h4>
                    {custodyLoadingIds.includes(String(item._id)) && <p role="status">Loading custody details...</p>}
                    {custodyErrors[item._id] && <div className="alert alert-warning" role="alert">{custodyErrors[item._id]}<button className="btn btn-sm btn-link" disabled={custodyLoadingIds.includes(String(item._id))} onClick={() => loadCustodyState(String(item._id))} type="button">Retry</button></div>}
                    {!custodyLoadingIds.includes(String(item._id)) && !custodyErrors[item._id] && !custodyStates[item._id]?.pending && <p className="mb-2">No pending custody transfer.</p>}
                    {custodyStates[item._id]?.pending && (
                      <div className="border rounded p-2 mb-3" data-testid={`pending-transfer-${item._id}`}>
                        <strong>Receipt pending</strong>
                        <div className="small">Sender: {officerName(custodyStates[item._id].pending.initiatedBy)}</div>
                        <div className="small">From custodian: {officerName(custodyStates[item._id].pending.fromCustodian)}</div>
                        <div className="small">Designated receiver: {officerName(custodyStates[item._id].pending.toCustodian)}</div>
                        <div className="small">Initiated: {dateTime(custodyStates[item._id].pending.initiatedAt)}</div>
                        {custodyStates[item._id].pending.remarks && <div className="small">Remarks: {custodyStates[item._id].pending.remarks}</div>}
                        {custodyStates[item._id].canAcknowledge && <button className="btn btn-sm btn-success mt-2" disabled={custodyActionIds.includes(item._id)} onClick={() => handleAcknowledgeCustodyTransfer(item, custodyStates[item._id].pending.transferId)} type="button">{custodyActionIds.includes(item._id) ? 'Acknowledging...' : 'Acknowledge receipt'}</button>}
                      </div>
                    )}
                    {!custodyLoadingIds.includes(String(item._id)) && !custodyErrors[item._id] && custodyStates[item._id]?.canInitiate && !custodyStates[item._id]?.pending && record.status !== 'Closed' && (
                      <form className="border rounded p-2 mb-3" onSubmit={(event) => handleInitiateCustodyTransfer(item, event)}>
                        <h5 className="h6">Initiate transfer</h5>
                        <label className="form-label" htmlFor={`custody-receiver-${item._id}`}>Receiving officer</label>
                        <select className="form-select mb-2" id={`custody-receiver-${item._id}`} onChange={(event) => setCustodyInputs((current) => ({ ...current, [item._id]: { ...current[item._id], toOfficerId: event.target.value } }))} required value={custodyInputs[item._id]?.toOfficerId || ''}>
                          <option value="">Select an assigned active officer</option>
                          {(record.assignedOfficerIds || []).filter((officer) => officer.status === 'active' && String(officer._id) !== String(item.currentCustodian?._id || item.currentCustodian || item.collectedBy?._id || item.collectedBy)).map((officer) => <option key={officer._id} value={officer._id}>{officer.name} ({officer.rank})</option>)}
                        </select>
                        <label className="form-label" htmlFor={`custody-remarks-${item._id}`}>Remarks (optional)</label>
                        <textarea className="form-control mb-2" id={`custody-remarks-${item._id}`} onChange={(event) => setCustodyInputs((current) => ({ ...current, [item._id]: { ...current[item._id], remarks: event.target.value } }))} rows="2" value={custodyInputs[item._id]?.remarks || ''} />
                        <button className="btn btn-sm btn-outline-primary" disabled={custodyActionIds.includes(item._id)} type="submit">{custodyActionIds.includes(item._id) ? 'Submitting...' : 'Send for acknowledgement'}</button>
                      </form>
                    )}
                    {!custodyLoadingIds.includes(String(item._id)) && !custodyErrors[item._id] && !custodyHistories[item._id]?.length && <p className="small text-secondary mb-0">No custody events recorded.</p>}
                    {custodyHistories[item._id]?.length > 0 && <ol className="list-unstyled mb-0">{custodyHistories[item._id].map((event) => <li className="border-bottom py-2" key={event._id}><strong>{event.action === 'TRANSFER_INITIATED' ? 'Transfer initiated' : event.action === 'TRANSFERRED' ? 'Transfer acknowledged' : event.action}</strong><div className="small text-secondary">{event.fromCustodian ? `${officerName(event.fromCustodian)} → ` : ''}{officerName(event.toCustodian)} · {dateTime(event.timestamp)}</div>{event.remarks && <div className="small">{event.remarks}</div>}</li>)}</ol>}
                  </section>}
                  {integrityResults[item._id]?.result && <div className="small mt-1" role="status">{integrityResultLabel(integrityResults[item._id].result)}</div>}
                  {integrityResults[item._id]?.error && <div className="small text-danger mt-1" role="alert">{integrityResults[item._id].error}</div>}
                  {isEvidenceHistoryExpanded(item._id) && (
                    <section className="border rounded p-3 mt-3" id={`evidence-history-panel-${item._id}`} aria-label={`History for evidence ${item.evidenceId}`}>
                      <h4 className="h6">Evidence history</h4>
                      {evidenceHistoryLoadingIds.includes(String(item._id)) && <p role="status">Loading evidence history...</p>}
                      {evidenceHistoryErrors[item._id] && <div className="alert alert-warning" role="alert">{evidenceHistoryErrors[item._id]}<button className="btn btn-sm btn-link" disabled={evidenceHistoryLoadingIds.includes(String(item._id))} onClick={() => loadEvidenceHistory(String(item._id), getEvidenceHistoryPage(String(item._id)).page)} type="button">Retry</button></div>}
                      {!evidenceHistoryLoadingIds.includes(String(item._id)) && !evidenceHistoryErrors[item._id] && (evidenceHistories[item._id] || []).length === 0 && <p className="mb-0">No history recorded for this evidence.</p>}
                      {(evidenceHistories[item._id] || []).length > 0 && (
                        <>
                          <ol className="list-unstyled mb-2">
                            {evidenceHistories[item._id].map((event) => (
                              <li className="border-bottom py-2" key={event.id}>
                                <strong>{evidenceHistoryDescription(event)}</strong>
                                <div className="small text-secondary">{event.actor?.username || 'Unknown actor'}{event.actor?.rank ? ` · ${event.actor.rank}` : ''} · <time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time></div>
                                {event.details?.status && <div className="small text-secondary">Status: {event.details.status}</div>}
                                {event.details?.verificationStatus && <div className="small text-secondary">Verification: {event.details.verificationStatus}</div>}
                              </li>
                            ))}
                          </ol>
                          {getEvidenceHistoryPage(item._id).totalPages > 1 && (
                            <div className="d-flex align-items-center gap-2">
                              <button className="btn btn-sm btn-outline-secondary" disabled={getEvidenceHistoryPage(item._id).page <= 1 || evidenceHistoryLoadingIds.includes(String(item._id))} onClick={() => loadEvidenceHistory(String(item._id), getEvidenceHistoryPage(item._id).page - 1)} type="button">Newer</button>
                              <span className="small">Page {getEvidenceHistoryPage(item._id).page} of {getEvidenceHistoryPage(item._id).totalPages}</span>
                              <button className="btn btn-sm btn-outline-secondary" disabled={getEvidenceHistoryPage(item._id).page >= getEvidenceHistoryPage(item._id).totalPages || evidenceHistoryLoadingIds.includes(String(item._id))} onClick={() => loadEvidenceHistory(String(item._id), getEvidenceHistoryPage(item._id).page + 1)} type="button">Older</button>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  )}
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
              <div className="detail-section-header d-flex align-items-center justify-content-between gap-3">
                <h3 className="mb-0">Case Timeline</h3>
                <button className="btn btn-sm btn-outline-secondary" aria-expanded={caseHistoryExpanded} aria-controls="case-history-panel" onClick={() => setCaseHistoryExpanded((current) => !current)} type="button">
                  {caseHistoryExpanded ? 'Hide Case Timeline' : 'Show Case Timeline'}
                </button>
              </div>
              {caseHistoryExpanded && <div id="case-history-panel">
                {caseHistoryError && <div className="alert alert-warning" role="alert">{caseHistoryError}</div>}
                {caseHistory.length ? caseHistory.map((entry) => (
                <div className="border rounded p-3 mb-2" key={entry._id || `${entry.action}-${entry.timestamp}`}>
                  <div className="d-flex justify-content-between gap-3 align-items-center flex-wrap">
                    <strong>{timelineEventTitle(entry)}</strong>
                    <span className="small text-secondary">{dateTime(entry.timestamp)}</span>
                  </div>
                  <div>{entry.description}</div>
                  <div className="small text-secondary">By {timelineEventActor(entry)} · Category: {entry.category || 'case'}</div>
                </div>
                )) : <p className="mb-0">No case timeline events recorded yet.</p>}
                {caseHistory.length > 0 && timelinePagination.totalPages > 1 && <div className="d-flex justify-content-between align-items-center mt-3"><button className="btn btn-sm btn-outline-primary" disabled={timelinePagination.page <= 1} onClick={() => loadTimelinePage(timelinePagination.page - 1)} type="button">Previous</button><span className="small text-secondary">Page {timelinePagination.page} of {timelinePagination.totalPages}</span><button className="btn btn-sm btn-outline-primary" disabled={timelinePagination.page >= timelinePagination.totalPages} onClick={() => loadTimelinePage(timelinePagination.page + 1)} type="button">Next</button></div>}
              </div>}
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
