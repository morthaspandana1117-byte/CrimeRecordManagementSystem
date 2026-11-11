import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { canManageOfficers } from '../authority'

const officerItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦', end: true },
  { to: '/cases', label: 'Cases', icon: '▤' },
  { to: '/firs', label: 'FIR Records', icon: '▥' },
  { to: '/crime-map', label: 'Crime Map', icon: '⌖' },
  { to: '/criminals', label: 'Criminal Records', icon: '◈' },
  { to: '/reports', label: 'Reports', icon: '▧' },
  { to: '/search', label: 'Advanced Search', icon: '⌕' },
]

const adminItems = [
  { to: '/admin/police-stations', label: 'Police Stations', icon: 'PS' },
  { to: '/admin/dashboard', label: 'Dashboard', icon: '▦', end: true },
  { to: '/officers', label: 'Officer Management', icon: '♙' },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: '▤' },
]

function DashboardSidebar({ title }) {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const isAdmin = user?.role === 'admin' || user?.systemRole === 'system_admin'
  const items = isAdmin
    ? adminItems
    : canManageOfficers(user)
      ? [...officerItems, { to: '/officers', label: 'Manage Officers', icon: '♙' }]
      : officerItems

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <button className="sidebar-toggle" aria-controls="dashboard-sidebar" aria-expanded={open} aria-label="Open main menu" onClick={() => setOpen(true)} type="button">
        <span aria-hidden="true">☰</span>
      </button>
      {open && <button className="sidebar-scrim" aria-label="Close main menu" onClick={() => setOpen(false)} type="button" />}
      <aside className={`dashboard-sidebar${open ? ' dashboard-sidebar-open' : ''}`} id="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-shield" aria-hidden="true">CR</div>
          <div><strong>CRMS</strong><span>Crime Records</span></div>
          <button className="sidebar-close" aria-label="Close main menu" onClick={() => setOpen(false)} type="button">×</button>
        </div>
        <div className="sidebar-profile">
          <div className="sidebar-avatar" aria-hidden="true">{(user?.name || user?.username || 'O').charAt(0).toUpperCase()}</div>
          <div><strong>{user?.name || user?.username || 'Officer'}</strong><span>{user?.rank || 'Administrator'}</span></div>
        </div>
        <p className="sidebar-heading">Main Menu</p>
        <nav aria-label="Main menu">
          <ul className="sidebar-nav">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink className="sidebar-link" end={item.end} onClick={() => setOpen(false)} to={item.to}>
                  <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-page-label">{title}</span>
          <button className="sidebar-logout" onClick={handleLogout} type="button"><span aria-hidden="true">↪</span> Log out</button>
          <NavLink className="sidebar-link" onClick={() => setOpen(false)} to="/profile">
            <span className="sidebar-icon" aria-hidden="true">♙</span>
            <span>Profile</span>
          </NavLink>
        </div>
      </aside>
    </>
  )
}

export default DashboardSidebar
