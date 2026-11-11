import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { canManageOfficers } from '../authority'
import Icon from './Icon'

const officerItems = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/cases', label: 'Cases', icon: 'cases' },
  { to: '/firs', label: 'FIR Records', icon: 'file' },
  { to: '/crime-map', label: 'Crime Map', icon: 'map' },
  { to: '/criminals', label: 'Criminal Records', icon: 'person' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/search', label: 'Advanced Search', icon: 'search' },
]

const adminItems = [
  { to: '/admin/police-stations', label: 'Police Stations', icon: 'building' },
  { to: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/officers', label: 'Officer Management', icon: 'users' },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: 'history' },
]

function DashboardSidebar({ title }) {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const isAdmin = user?.role === 'admin' || user?.systemRole === 'system_admin'
  const items = isAdmin
    ? adminItems
    : canManageOfficers(user)
      ? [...officerItems, { to: '/officers', label: 'Manage Officers', icon: 'users' }]
      : officerItems

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <button className="sidebar-toggle" aria-controls="dashboard-sidebar" aria-expanded={open} aria-label="Open main menu" onClick={() => setOpen(true)} type="button">
        <Icon name="menu" size={21} />
      </button>
      {open && <button className="sidebar-scrim" aria-label="Close main menu" onClick={() => setOpen(false)} type="button" />}
      <aside className={`dashboard-sidebar${open ? ' dashboard-sidebar-open' : ''}`} id="dashboard-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-shield"><Icon name="shield" size={21} /></div>
          <div><strong>CRMS</strong><span>Crime Records</span></div>
          <button className="sidebar-close" aria-label="Close main menu" onClick={() => setOpen(false)} type="button"><Icon name="close" size={20} /></button>
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
                  <span className="sidebar-icon"><Icon name={item.icon} size={18} /></span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-page-label">{title}</span>
          <button className="sidebar-link sidebar-logout" onClick={handleLogout} type="button">
            <span className="sidebar-icon" aria-hidden="true">
              <Icon name="logout" size={18} />
            </span>
            <span>Log out</span>
          </button>
          <NavLink className="sidebar-link" onClick={() => setOpen(false)} to="/profile">
            <span className="sidebar-icon"><Icon name="user-circle" size={18} /></span>
            <span>Profile</span>
          </NavLink>
        </div>
      </aside>
    </>
  )
}

export default DashboardSidebar
