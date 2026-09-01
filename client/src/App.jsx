import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/useAuth'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'

function HomeRedirect() {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <main className="page-loader" aria-label="Checking your session"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Checking your secure session...</span></main>
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}

export default App
