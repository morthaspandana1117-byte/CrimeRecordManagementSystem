import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getAdminDashboardStats } from '../services/api'
import DashboardSidebar from '../components/DashboardSidebar'

const statCards = [
  { key: 'totalUsers', label: 'System Users', icon: 'US' },
  { key: 'totalOfficers', label: 'Officers', icon: 'OF' },
  { key: 'pendingOfficers', label: 'Pending Registrations', icon: 'PD' },
  { key: 'totalFIRs', label: 'FIRs', icon: 'FI' },
  { key: 'totalCases', label: 'Cases', icon: 'CA' },
  { key: 'totalEvidence', label: 'Evidence Items', icon: 'EV' },
  { key: 'totalReports', label: 'Reports', icon: 'RP' },
]

function AdminDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getAdminDashboardStats()
      setStats(response.data.data)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load dashboard statistics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(loadStats, 0)
    return () => window.clearTimeout(timer)
  }, [loadStats])

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="System Administration" />
      <div className="dashboard-main">
      <header className="dashboard-header"><div className="container-fluid d-flex align-items-center justify-content-between gap-3 py-3"><div><p className="header-kicker mb-0">CRMS / MAIN MENU</p><h1 className="header-title mb-0">System Administration</h1></div></div></header>
      <main className="container-fluid py-4 py-md-5">
        <section className="welcome-card mb-4"><div><p className="eyebrow mb-1">System administrator</p><h2 className="mb-1">Welcome, {user?.username || 'Administrator'}</h2><p className="mb-0 text-secondary">Account management and system configuration.</p></div><div className="d-flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => navigate('/officers')} type="button">Manage officer accounts</button><button className="btn btn-outline-primary" onClick={() => navigate('/admin/audit-logs')} type="button">Audit Logs</button></div></section>
        <div className="d-flex align-items-end justify-content-between gap-3 mb-3"><div><p className="eyebrow mb-1">System overview</p><h2 className="section-title mb-0">Record statistics</h2></div><button className="btn btn-outline-primary" disabled={loading} onClick={loadStats} type="button">Refresh</button></div>
        {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Loading dashboard statistics...</p></div>}
        {!loading && error && <div className="alert alert-danger" role="alert">{error}</div>}
        {!loading && !error && stats && <div className="row g-3 g-md-4">{statCards.map(({ key, label, icon }) => <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={key}><article className="stat-card h-100"><span className="stat-icon" aria-hidden="true">{icon}</span><p className="stat-label">{label}</p><p className="stat-value">{Number(stats[key] || 0).toLocaleString()}</p></article></div>)}</div>}
      </main></div>
    </div>
  )
}

export default AdminDashboard
