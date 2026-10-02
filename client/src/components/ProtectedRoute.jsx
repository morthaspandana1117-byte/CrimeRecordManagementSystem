import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getRank, getSystemRole, isSystemAdmin } from '../authority'

function ProtectedRoute({ allowedRanks, allowedRoles, allowedSystemRoles, allowSystemAdmin = false, children }) {
  const { isAuthenticated, loading, user } = useAuth()
  const location = useLocation()
  if (loading) {
    return <main className="page-loader" aria-label="Checking your session"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Checking your secure session...</span></main>
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  const systemRole = getSystemRole(user)
  const roleAllowed = !allowedRoles || allowedRoles.includes(user?.role) || allowedRoles.includes(systemRole)
  const systemRoleAllowed = !allowedSystemRoles || allowedSystemRoles.includes(systemRole)
  const rank = getRank(user)
  const rankAllowed = !allowedRanks || allowedRanks.includes(rank)
  const authorityAllowed = (allowedRanks || allowedSystemRoles)
    ? (rankAllowed || (allowSystemAdmin && isSystemAdmin(user)) || (allowedSystemRoles?.includes(systemRole) ?? false))
    : true
  if (!roleAllowed || !systemRoleAllowed || !authorityAllowed) {
    const destination = isSystemAdmin(user) ? '/admin/dashboard' : '/dashboard'
    if (location.pathname !== destination) return <Navigate to={destination} replace />
    return <main className="container py-5" role="alert"><h1 className="h4">Access unavailable</h1><p>Your account does not have a recognized rank for this page. Contact a system administrator to review your officer profile.</p><Link to="/login">Sign in with another account</Link></main>
  }
  return children
}

export default ProtectedRoute
