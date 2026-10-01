import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getFIRs } from '../services/api'

const validStatuses = ['Open', 'Registered', 'Under Investigation', 'Charge Sheet Filed', 'Closed']
const crimeTypes = ['Theft', 'Robbery', 'Murder', 'Assault', 'Kidnapping', 'Fraud', 'Cyber Crime', 'Drug Offense', 'Sexual Offense', 'Property Crime', 'Other']

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const formatDate = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

const formatStatus = (value) => {
  if (!value) return 'Unknown'
  return value
}

const getStatusClass = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'open') return 'status-badge status-approved'
  if (normalized === 'registered') return 'status-badge status-active'
  if (normalized === 'under investigation') return 'status-badge status-pending'
  if (normalized === 'charge sheet filed') return 'status-badge status-rejected'
  if (normalized === 'closed') return 'status-badge status-inactive'
  return 'status-badge'
}

function FIRList() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [firs, setFIRs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [crimeTypeFilter, setCrimeTypeFilter] = useState('all')

  const buildParams = useMemo(() => {
    const params = {}
    if (search.trim()) params.search = search.trim()
    if (statusFilter !== 'all') params.status = statusFilter
    if (crimeTypeFilter !== 'all') params.crimeType = crimeTypeFilter
    return params
  }, [search, statusFilter, crimeTypeFilter])

  const loadFIRs = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getFIRs(buildParams)
      setFIRs(Array.isArray(response.data?.data) ? response.data.data : [])
    } catch (requestError) {
      setError(requestMessage(requestError, 'Could not load FIR records.'))
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFIRs()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [loadFIRs])

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
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">FIR Management</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate(user?.role === 'admin' ? '/admin/dashboard' : '/dashboard')} type="button">Dashboard</button>
            <button className="btn btn-outline-light" onClick={handleLogout} type="button">Log out</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="d-flex align-items-end justify-content-between gap-3 mb-3">
          <div>
            <p className="eyebrow mb-1">FIR records</p>
            <h2 className="section-title mb-0">FIR list</h2>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/firs/create')} type="button">Add FIR</button>
        </div>

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <section className="fir-control-panel mb-4">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-lg-5">
              <label className="form-label" htmlFor="fir-search">Search FIRs</label>
              <div className="input-group">
                <input
                  className="form-control"
                  id="fir-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="FIR no., complainant, police station"
                  type="search"
                  value={search}
                />
                {search && (
                  <button className="btn btn-outline-secondary" onClick={() => setSearch('')} type="button">Clear</button>
                )}
              </div>
            </div>

            <div className="col-12 col-md-4 col-lg-3">
              <label className="form-label" htmlFor="fir-status-filter">Status</label>
              <select className="form-select" id="fir-status-filter" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All</option>
                {validStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div className="col-12 col-md-4 col-lg-3">
              <label className="form-label" htmlFor="fir-type-filter">Crime type</label>
              <select className="form-select" id="fir-type-filter" onChange={(event) => setCrimeTypeFilter(event.target.value)} value={crimeTypeFilter}>
                <option value="all">All</option>
                {crimeTypes.map((crimeType) => (
                  <option key={crimeType} value={crimeType}>{crimeType}</option>
                ))}
              </select>
            </div>

            <div className="col-12 col-md-4 col-lg-1 d-flex justify-content-md-end">
              <button className="btn btn-outline-primary w-100" disabled={loading} onClick={loadFIRs} type="button">
                {loading ? '...' : 'Refresh'}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading FIR records...</p>
          </div>
        ) : firs.length === 0 ? (
          <div className="dashboard-state empty-state-box">
            <p className="mb-0">No FIR records are available yet. Add an FIR to get started.</p>
          </div>
        ) : (
          <div className="fir-table-card table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>FIR No.</th>
                  <th>Date</th>
                  <th>Police Station</th>
                  <th>Complainant</th>
                  <th>Crime Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {firs.map((fir) => (
                  <tr key={fir._id}>
                    <td>{fir.firNo || '—'}</td>
                    <td>{formatDate(fir.date)}</td>
                    <td>{fir.policeStation || '—'}</td>
                    <td>{fir.complaint?.complainantName || '—'}</td>
                    <td>{fir.crimeType || '—'}</td>
                    <td><span className={getStatusClass(fir.status)}>{formatStatus(fir.status)}</span></td>
                    <td>
                      <div className="action-stack">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/firs/${fir._id}`)} type="button">View</button>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/firs/${fir._id}/edit`)} type="button">Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export default FIRList
