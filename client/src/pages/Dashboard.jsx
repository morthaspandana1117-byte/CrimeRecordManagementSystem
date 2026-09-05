import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getDashboardStats } from '../services/api'

const statCards = [
  { key: 'totalFIRs', label: 'FIRs', icon: 'FI' },
  { key: 'totalCases', label: 'Cases', icon: 'CA' },
  { key: 'totalEvidence', label: 'Evidence Items', icon: 'EV' },
  { key: 'totalReports', label: 'Reports', icon: 'RP' },
]

const getDashboardError = (error) => {
  if (!error.response) return 'Unable to reach the CRMS server. Please try again.'
  return error.response.data?.message || 'Could not load dashboard statistics.'
}

const formatRole = (role) => role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : 'Officer'

function Dashboard() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getDashboardStats()
      setStats(response.data.data)
    } catch (requestError) {
      setError(getDashboardError(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timerId = window.setTimeout(loadStats, 0)
    return () => window.clearTimeout(timerId)
  }, [loadStats])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const allCountsAreZero = stats && statCards.every(({ key }) => stats[key] === 0)

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Officer Dashboard</h1></div>
          </div>
          <button className="btn btn-outline-light" onClick={handleLogout} type="button">Log out</button>
        </div>
      </header>
      <main className="container py-4 py-md-5">
        <section className="welcome-card mb-4">
          <div><p className="eyebrow mb-1">Officer account</p><h2 className="mb-1">Welcome, {user?.name || user?.username || 'Officer'}</h2><p className="mb-1 text-secondary">{user?.email || 'Email not available'}</p><p className="mb-0 text-secondary">Role: {formatRole(user?.role)}</p></div>
          {typeof user?.isActive === 'boolean' && <div className="account-badge"><span>Account status</span><strong>{user.isActive ? 'Active' : 'Inactive'}</strong></div>}
        </section>
        <div className="d-flex align-items-end justify-content-between gap-3 mb-3">
          <div><p className="eyebrow mb-1">Operational overview</p><h2 className="section-title mb-0">Record statistics</h2></div>
          <button className="btn btn-outline-primary" disabled={loading} onClick={loadStats} type="button">Refresh</button>
        </div>
        {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" aria-hidden="true" /><p className="mb-0">Loading dashboard statistics...</p></div>}
        {!loading && error && <div className="dashboard-state"><div className="alert alert-danger mb-3" role="alert">{error}</div><button className="btn btn-primary" onClick={loadStats} type="button">Try again</button></div>}
        {!loading && !error && stats && <>
          {allCountsAreZero && <div className="alert alert-info">No records have been added to the system yet. The totals will update when records become available.</div>}
          <div className="row g-3 g-md-4">{statCards.map(({ key, label, icon }) => <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={key}><article className="stat-card h-100"><span className="stat-icon" aria-hidden="true">{icon}</span><p className="stat-label">{label}</p><p className="stat-value">{Number(stats[key] || 0).toLocaleString()}</p></article></div>)}</div>
        </>}
      </main>
    </div>
  )
}

export default Dashboard
