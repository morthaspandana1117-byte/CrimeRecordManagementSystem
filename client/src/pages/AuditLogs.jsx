import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getAuditLogs, verifyAuditIntegrity } from '../services/api'
import { auditIntegrityPresentation } from '../utils/auditIntegrity'

const pageSize = 25

const getErrorMessage = (error, fallback) =>
  error.response?.data?.message || (!error.response ? 'Unable to reach the CRMS server. Please try again.' : fallback)

const formatTimestamp = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

const formatActor = (actor) => {
  if (!actor) return 'System'
  if (typeof actor === 'string') return actor
  return actor.username || actor.role || 'System'
}

function AuditLogs() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: pageSize, totalRecords: 0, totalPages: 1 })
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [integrity, setIntegrity] = useState(null)
  const [integrityLoading, setIntegrityLoading] = useState(false)
  const [integrityError, setIntegrityError] = useState('')

  const loadRecords = useCallback(async (page = 1) => {
    try {
      setLoading(true)
      setError('')
      const params = {
        page,
        limit: pageSize,
        ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
        ...(filters.entityType.trim() ? { entityType: filters.entityType.trim() } : {}),
        ...(filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
        ...(filters.to ? { to: new Date(`${filters.to}T23:59:59.999`).toISOString() } : {}),
      }
      const response = await getAuditLogs(params)
      setRecords(Array.isArray(response.data.data) ? response.data.data : [])
      setPagination(response.data.pagination || { page, limit: pageSize, totalRecords: 0, totalPages: 1 })
    } catch (requestError) {
      setRecords([])
      setError(getErrorMessage(requestError, 'Could not load audit logs.'))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    const timerId = window.setTimeout(() => loadRecords(1), 0)
    return () => window.clearTimeout(timerId)
  }, [loadRecords])

  const handleVerify = async () => {
    try {
      setIntegrityLoading(true)
      setIntegrityError('')
      const response = await verifyAuditIntegrity()
      setIntegrity(response.data.data)
    } catch (requestError) {
      setIntegrity(null)
      setIntegrityError(getErrorMessage(requestError, 'Could not verify audit integrity.'))
    } finally {
      setIntegrityLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Audit Logs</h1></div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/admin/dashboard')} type="button">Dashboard</button>
            <button className="btn btn-outline-light" onClick={handleLogout} type="button">Log out</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <section className="welcome-card mb-4">
          <div><p className="eyebrow mb-1">System administrator</p><h2 className="mb-1">Security activity history</h2><p className="mb-0 text-secondary">Review application audit events and verify the protected integrity chain.</p></div>
          <button className="btn btn-primary" disabled={integrityLoading} onClick={handleVerify} type="button">
            {integrityLoading ? 'Verifying...' : 'Verify Integrity'}
          </button>
        </section>

        {integrityError && <div className="alert alert-danger" role="alert">{integrityError}</div>}
        {integrity && (() => {
          const presentation = auditIntegrityPresentation(integrity)
          const legacyRecords = Number(integrity.unprotectedRecords ?? integrity.legacyRecords ?? 0)
          return <section className={`audit-integrity-card mb-4 ${presentation.cardClass}`} aria-live="polite">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
            <div><p className="eyebrow mb-1">Integrity verification</p><h2 className="section-title mb-0">{presentation.title}</h2></div>
            <span className={`status-badge ${presentation.statusClass}`}>{presentation.statusLabel}</span>
          </div>
          <div className="row g-3">
            <div className="col-6 col-lg-3"><div className="audit-summary-item"><span>Records checked</span><strong>{Number(integrity.checkedRecords || 0).toLocaleString()}</strong></div></div>
            <div className="col-6 col-lg-3"><div className="audit-summary-item"><span>Protected records</span><strong>{Number(integrity.protectedRecords || 0).toLocaleString()}</strong></div></div>
            <div className="col-6 col-lg-3"><div className="audit-summary-item"><span>Legacy / unprotected</span><strong>{Number(integrity.unprotectedRecords ?? integrity.legacyRecords ?? 0).toLocaleString()}</strong></div></div>
            <div className="col-6 col-lg-3"><div className="audit-summary-item"><span>Malformed records</span><strong>{Number(integrity.malformedRecords || 0).toLocaleString()}</strong></div></div>
          </div>
          <div className={`alert ${presentation.alertClass} mt-3 mb-0`} role={integrity.valid ? 'status' : 'alert'}>
            <strong>{presentation.notice}</strong>
            {integrity.valid && legacyRecords > 0 && <div className="mt-1">“Hash chain valid” means all protected records passed integrity verification; it does not mean every audit record is protected.</div>}
          </div>
          {integrity.issue && <p className="mb-0 mt-3 text-danger">Issue: {integrity.issue}</p>}
        </section>
        })()}

        <section className="audit-control-panel mb-4">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-4"><label className="form-label" htmlFor="audit-action">Action</label><input className="form-control" id="audit-action" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="e.g. LOGIN_SUCCESS" /></div>
            <div className="col-12 col-md-3"><label className="form-label" htmlFor="audit-entity">Entity type</label><input className="form-control" id="audit-entity" value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })} placeholder="e.g. Officer" /></div>
            <div className="col-6 col-md-2"><label className="form-label" htmlFor="audit-from">From</label><input className="form-control" id="audit-from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></div>
            <div className="col-6 col-md-2"><label className="form-label" htmlFor="audit-to">To</label><input className="form-control" id="audit-to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></div>
            <div className="col-12 col-md-1"><button className="btn btn-outline-secondary w-100" onClick={() => setFilters({ action: '', entityType: '', from: '', to: '' })} type="button">Clear</button></div>
          </div>
        </section>

        {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" aria-hidden="true" /><p className="mb-0">Loading audit logs...</p></div>}
        {!loading && error && <div className="dashboard-state"><div className="alert alert-danger mb-3" role="alert">{error}</div><button className="btn btn-primary" onClick={() => loadRecords(pagination.page)} type="button">Try again</button></div>}
        {!loading && !error && records.length === 0 && <div className="empty-state-box text-center"><h2 className="h5">No audit records found</h2><p className="mb-0 text-secondary">Try changing the filters or check back after activity is recorded.</p></div>}
        {!loading && !error && records.length > 0 && <section className="audit-table-card">
          <div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Actor</th><th>Action</th><th>Entity type</th><th>Entity ID</th><th>Timestamp</th></tr></thead><tbody>
            {records.map((record) => <tr key={record._id}><td>{formatActor(record.actor)}</td><td><span className="audit-action">{record.action || '—'}</span></td><td>{record.entityType || '—'}</td><td><span className="audit-entity-id">{record.entityId || '—'}</span></td><td>{formatTimestamp(record.occurredAt)}</td></tr>)}
          </tbody></table></div>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 p-3 border-top"><p className="mb-0 text-secondary">Showing page {pagination.page} of {pagination.totalPages} · {Number(pagination.totalRecords || 0).toLocaleString()} total records</p><div className="d-flex gap-2"><button className="btn btn-sm btn-outline-primary" disabled={pagination.page <= 1 || loading} onClick={() => loadRecords(pagination.page - 1)} type="button">Previous</button><button className="btn btn-sm btn-outline-primary" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadRecords(pagination.page + 1)} type="button">Next</button></div></div>
        </section>}
      </main>
    </div>
  )
}

export default AuditLogs
