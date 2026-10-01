import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getCriminals } from '../services/api'

const validStatuses = ['active', 'inactive', 'wanted', 'arrested', 'released', 'deceased']

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const formatStatus = (value) => {
  if (!value) return 'Unknown'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const getStatusClass = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'active') return 'status-badge status-active'
  if (normalized === 'inactive') return 'status-badge status-inactive'
  if (normalized === 'wanted') return 'status-badge status-pending'
  if (normalized === 'arrested') return 'status-badge status-rejected'
  if (normalized === 'released') return 'status-badge status-approved'
  if (normalized === 'deceased') return 'status-badge status-inactive'
  return 'status-badge'
}

function CriminalList() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [criminals, setCriminals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const buildParams = useMemo(() => {
    const params = {}
    if (search.trim()) params.search = search.trim()
    if (statusFilter !== 'all') params.status = statusFilter
    return params
  }, [search, statusFilter])

  const loadCriminals = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getCriminals(buildParams)
      setCriminals(Array.isArray(response.data?.data) ? response.data.data : [])
    } catch (requestError) {
      setError(requestMessage(requestError, 'Could not load criminal records.'))
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCriminals()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [loadCriminals])

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
              <h1 className="header-title mb-0">Criminal Management</h1>
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
            <p className="eyebrow mb-1">Criminal records</p>
            <h2 className="section-title mb-0">Criminal list</h2>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/criminals/add')} type="button">Add Criminal</button>
        </div>

        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <section className="criminal-control-panel mb-4">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-lg-6">
              <label className="form-label" htmlFor="criminal-search">Search criminals</label>
              <div className="input-group">
                <input
                  className="form-control"
                  id="criminal-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Criminal ID or full name"
                  type="search"
                  value={search}
                />
                {search && (
                  <button className="btn btn-outline-secondary" onClick={() => setSearch('')} type="button">Clear</button>
                )}
              </div>
            </div>

            <div className="col-12 col-md-4 col-lg-3">
              <label className="form-label" htmlFor="status-filter">Status</label>
              <select className="form-select" id="status-filter" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All</option>
                {validStatuses.map((status) => (
                  <option key={status} value={status}>{formatStatus(status)}</option>
                ))}
              </select>
            </div>

            <div className="col-12 col-md-4 col-lg-3 d-flex justify-content-md-end">
              <button className="btn btn-outline-primary w-100" disabled={loading} onClick={loadCriminals} type="button">
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading criminal records...</p>
          </div>
        ) : criminals.length === 0 ? (
          <div className="dashboard-state empty-state-box">
            <p className="mb-0">No criminal records are available yet. Add a criminal record to get started.</p>
          </div>
        ) : (
          <div className="criminal-table-card table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Criminal ID</th>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {criminals.map((criminal) => (
                  <tr key={criminal._id}>
                    <td>{criminal.criminalId || '—'}</td>
                    <td>{criminal.fullName || 'Not available'}</td>
                    <td>{criminal.gender || '—'}</td>
                    <td><span className={getStatusClass(criminal.status)}>{formatStatus(criminal.status)}</span></td>
                    <td>
                      <div className="action-stack">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/criminals/${criminal._id}`)} type="button">View</button>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/criminals/${criminal._id}/edit`)} type="button">Edit</button>
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

export default CriminalList
