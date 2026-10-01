import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { getSystemRole, isSystemAdmin } from '../authority'

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
  const rankAllowed = !allowedRanks || allowedRanks.includes(user?.rank)
  const authorityAllowed = (allowedRanks || allowedSystemRoles)
    ? (rankAllowed || (allowSystemAdmin && isSystemAdmin(user)) || (allowedSystemRoles?.includes(systemRole) ?? false))
    : true
  if (!roleAllowed || !systemRoleAllowed || !authorityAllowed) {
    return <Navigate to={isSystemAdmin(user) ? '/admin/dashboard' : '/dashboard'} replace />
  }
  return children
}

export default ProtectedRoute
