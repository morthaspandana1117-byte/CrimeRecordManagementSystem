import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, user } = useAuth()
  const location = useLocation()
  if (loading) {
    return <main className="page-loader" aria-label="Checking your session"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Checking your secure session...</span></main>
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={user?.role === 'admin' ? '/admin/dashboard' : '/dashboard'} replace />
  }
  return children
}

export default ProtectedRoute
