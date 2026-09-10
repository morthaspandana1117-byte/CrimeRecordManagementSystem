import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getAdminDashboardStats } from '../services/api'

const statCards = [
  { key: 'totalUsers', label: 'System Users', icon: 'US' }, { key: 'totalOfficers', label: 'Officers', icon: 'OF' },
  { key: 'pendingOfficers', label: 'Pending Registrations', icon: 'PD' }, { key: 'totalFIRs', label: 'FIRs', icon: 'FI' },
  { key: 'totalCases', label: 'Cases', icon: 'CA' }, { key: 'totalEvidence', label: 'Evidence Items', icon: 'EV' }, { key: 'totalReports', label: 'Reports', icon: 'RP' },
]

function AdminDashboard() {
  const { logout, user } = useAuth(); const navigate = useNavigate(); const [stats, setStats] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const loadStats = useCallback(async () => { try { setLoading(true); setError(''); const response = await getAdminDashboardStats(); setStats(response.data.data) } catch (requestError) { setError(requestError.response?.data?.message || 'Could not load dashboard statistics.') } finally { setLoading(false) } }, [])
  useEffect(() => { loadStats() }, [loadStats])
  return <div className="dashboard-page"><header className="dashboard-header"><div className="container d-flex align-items-center justify-content-between gap-3 py-3"><div className="d-flex align-items-center gap-3"><div className="brand-mark brand-mark-small" aria-hidden="true">CR</div><div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Admin Dashboard</h1></div></div><button className="btn btn-outline-light" onClick={() => { logout(); navigate('/login', { replace: true }) }} type="button">Log out</button></div></header><main className="container py-4 py-md-5"><section className="welcome-card mb-4"><div><p className="eyebrow mb-1">Administrator account</p><h2 className="mb-1">Welcome, {user?.username || 'Administrator'}</h2><p className="mb-0 text-secondary">System-wide records and officer approvals.</p></div><button className="btn btn-primary" onClick={() => navigate('/officers')} type="button">Manage officers</button></section><div className="d-flex align-items-end justify-content-between gap-3 mb-3"><div><p className="eyebrow mb-1">System overview</p><h2 className="section-title mb-0">Record statistics</h2></div><button className="btn btn-outline-primary" disabled={loading} onClick={loadStats} type="button">Refresh</button></div>{loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Loading dashboard statistics...</p></div>}{!loading && error && <div className="alert alert-danger" role="alert">{error}</div>}{!loading && !error && stats && <div className="row g-3 g-md-4">{statCards.map(({ key, label, icon }) => <div className="col-12 col-sm-6 col-lg-4 col-xl-3" key={key}><article className="stat-card h-100"><span className="stat-icon">{icon}</span><p className="stat-label">{label}</p><p className="stat-value">{Number(stats[key] || 0).toLocaleString()}</p></article></div>)}</div>}</main></div>
}

export default AdminDashboard
