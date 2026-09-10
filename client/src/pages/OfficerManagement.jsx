import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import {
  approveOfficer,
  getOfficers,
  rejectOfficer,
  updateOfficerAccountStatus,
} from '../services/api'

const requestMessage = (error, fallback) => error.response?.data?.message || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const getApprovalStatus = (officer) => officer?.userId?.status || 'approved'
const getAccountStatus = (officer) => {
  if (officer?.userId?.isActive === false || officer?.status === 'inactive') return 'inactive'
  return 'active'
}

const getBadgeClass = (value) => { 
  const status = String(value || '').toLowerCase()
  if (status === 'pending') return 'status-badge status-pending'
  if (status === 'approved') return 'status-badge status-approved'
  if (status === 'rejected') return 'status-badge status-rejected'
  if (status === 'active') return 'status-badge status-active'
  if (status === 'inactive') return 'status-badge status-inactive'
  return 'status-badge'
}

function OfficerManagement() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [loadingActionId, setLoadingActionId] = useState('')

  const buildParams = useMemo(() => {
    const params = {}
    if (search.trim()) params.search = search.trim()
    if (approvalFilter !== 'all') params.approvalStatus = approvalFilter
    if (accountFilter !== 'all') params.accountStatus = accountFilter
    return params
  }, [search, approvalFilter, accountFilter])

  const loadOfficers = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getOfficers(buildParams)
      setOfficers(Array.isArray(response.data?.data) ? response.data.data : [])
    } catch (requestError) {
      setError(requestMessage(requestError, 'Could not load officers.'))
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOfficers()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [loadOfficers])

  const handleStatusToggle = async (officer) => {
    const currentAccountStatus = getAccountStatus(officer)
    const nextStatus = currentAccountStatus === 'active' ? 'inactive' : 'active'
    const confirmed = window.confirm(`Are you sure you want to ${nextStatus === 'active' ? 'activate' : 'deactivate'} this officer?\n\n${officer.name}`)
    if (!confirmed) return

    try {
      setLoadingActionId(officer._id)
      setError('')
      setNotice('')
      const response = await updateOfficerAccountStatus(officer._id, nextStatus)
      setNotice(response.data?.message || `Officer ${nextStatus === 'active' ? 'activated' : 'deactivated'} successfully.`)
      await loadOfficers()
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to update the officer account status.'))
    } finally {
      setLoadingActionId('')
    }
  }

  const handleReview = async (officer, action) => {
    const actionText = action === 'approve' ? 'approve' : 'reject'
    const confirmed = window.confirm(`Are you sure you want to ${actionText} this officer registration?\n\n${officer.name}`)
    if (!confirmed) return

    try {
      setLoadingActionId(officer._id)
      setError('')
      setNotice('')
      const request = action === 'approve' ? approveOfficer(officer._id) : rejectOfficer(officer._id)
      const response = await request
      setNotice(response.data?.message || `Officer ${actionText}ed successfully.`)
      await loadOfficers()
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to review the officer registration.'))
    } finally {
      setLoadingActionId('')
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
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">Officer Management</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/admin/dashboard')} type="button">Dashboard</button>
            <button className="btn btn-outline-light" onClick={handleLogout} type="button">Log out</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="d-flex align-items-end justify-content-between gap-3 mb-3">
          <div>
            <p className="eyebrow mb-1">Officer Management</p>
            <h2 className="section-title mb-0">Officer registrations</h2>
          </div>
        </div>

        {notice && <div className="alert alert-success" role="status">{notice}</div>}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        <section className="officer-control-panel mb-4">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-lg-5">
              <label className="form-label" htmlFor="officer-search">Search officers</label>
              <div className="input-group">
                <input
                  className="form-control"
                  id="officer-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, ID, batch, username"
                  type="search"
                  value={search}
                />
                {search && (
                  <button className="btn btn-outline-secondary" onClick={() => setSearch('')} type="button">Clear</button>
                )}
              </div>
            </div>

            <div className="col-12 col-md-3 col-lg-2">
              <label className="form-label" htmlFor="approval-filter">Approval</label>
              <select className="form-select" id="approval-filter" onChange={(event) => setApprovalFilter(event.target.value)} value={approvalFilter}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="col-12 col-md-3 col-lg-2">
              <label className="form-label" htmlFor="account-filter">Account</label>
              <select className="form-select" id="account-filter" onChange={(event) => setAccountFilter(event.target.value)} value={accountFilter}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="col-12 col-md-3 col-lg-3 d-flex justify-content-md-end">
              <button className="btn btn-outline-primary w-100" disabled={loading} onClick={() => loadOfficers()} type="button">
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading officers...</p>
          </div>
        ) : officers.length === 0 ? (
          <div className="dashboard-state empty-state-box">
            <p className="mb-0">No officers match the current search and filters.</p>
          </div>
        ) : (
          <div className="officer-table-card table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Username</th>
                  <th>Batch No.</th>
                  <th>Approval</th>
                  <th>Account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {officers.map((officer) => {
                  const approvalStatus = getApprovalStatus(officer)
                  const accountStatus = getAccountStatus(officer)
                  const isActionBusy = loadingActionId === officer._id

                  return (
                    <tr key={officer._id}>
                      <td>
                        <div className="fw-semibold">{officer.name || 'Unnamed officer'}</div>
                        <small className="text-secondary">{officer.rank || 'Rank not available'} · {officer.department || 'Department not available'}</small>
                      </td>
                      <td>{officer.userId?.username || 'Not available'}</td>
                      <td>
                        <div>{officer.badgeNumber || '—'}</div>
                        <small className="text-secondary">ID: {officer.officerId || '—'}</small>
                      </td>
                      <td><span className={getBadgeClass(approvalStatus)}>{approvalStatus}</span></td>
                      <td><span className={getBadgeClass(accountStatus)}>{accountStatus}</span></td>
                      <td>
                        <div className="action-stack">
                          <button className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/officers/${officer._id}`)} type="button">View</button>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/officers/${officer._id}/edit`)} type="button">Update</button>
                          <button className="btn btn-sm btn-outline-warning" disabled={isActionBusy} onClick={() => handleStatusToggle(officer)} type="button">
                            {isActionBusy ? 'Working...' : accountStatus === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          {approvalStatus === 'pending' && (
                            <>
                              <button className="btn btn-sm btn-success" disabled={isActionBusy} onClick={() => handleReview(officer, 'approve')} type="button">Approve</button>
                              <button className="btn btn-sm btn-outline-danger" disabled={isActionBusy} onClick={() => handleReview(officer, 'reject')} type="button">Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export default OfficerManagement
