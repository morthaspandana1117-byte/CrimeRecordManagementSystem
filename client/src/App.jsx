import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/useAuth'
import AdminDashboard from './pages/AdminDashboard'
import CriminalAdd from './pages/CriminalAdd'
import CriminalDetails from './pages/CriminalDetails'
import CriminalEdit from './pages/CriminalEdit'
import CriminalList from './pages/CriminalList'
import Dashboard from './pages/Dashboard'
import EvidenceCreate from './pages/EvidenceCreate'
import CaseCreate from './pages/CaseCreate'
import CaseDetails from './pages/CaseDetails'
import CaseEdit from './pages/CaseEdit'
import CaseList from './pages/CaseList'
import FIRCreate from './pages/FIRCreate'
import FIRDetails from './pages/FIRDetails'
import FIREdit from './pages/FIREdit'
import FIRList from './pages/FIRList'
import ForgotPassword from './pages/ForgotPassword'
import Login from './pages/Login'
import OfficerDetails from './pages/OfficerDetails'
import OfficerEdit from './pages/OfficerEdit'
import OfficerManagement from './pages/OfficerManagement'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'

function HomeRedirect() {
  const { isAuthenticated, loading, user } = useAuth()
  if (loading) return <main className="page-loader" aria-label="Checking your session"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Checking your secure session...</span></main>
  return <Navigate to={isAuthenticated ? (user?.role === 'admin' ? '/admin/dashboard' : '/dashboard') : '/login'} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['officer']}><Dashboard /></ProtectedRoute>} />
      <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/officers" element={<ProtectedRoute allowedRoles={['admin']}><OfficerManagement /></ProtectedRoute>} />
      <Route path="/officers/:id" element={<ProtectedRoute allowedRoles={['admin']}><OfficerDetails /></ProtectedRoute>} />
      <Route path="/officers/:id/edit" element={<ProtectedRoute allowedRoles={['admin']}><OfficerEdit /></ProtectedRoute>} />
      <Route path="/criminals" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CriminalList /></ProtectedRoute>} />
      <Route path="/criminals/add" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CriminalAdd /></ProtectedRoute>} />
      <Route path="/criminals/:id" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CriminalDetails /></ProtectedRoute>} />
      <Route path="/criminals/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CriminalEdit /></ProtectedRoute>} />
      <Route path="/firs" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><FIRList /></ProtectedRoute>} />
      <Route path="/firs/create" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><FIRCreate /></ProtectedRoute>} />
      <Route path="/firs/:id" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><FIRDetails /></ProtectedRoute>} />
      <Route path="/firs/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><FIREdit /></ProtectedRoute>} />
      <Route path="/cases" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CaseList /></ProtectedRoute>} />
      <Route path="/cases/create" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CaseCreate /></ProtectedRoute>} />
      <Route path="/cases/:id" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CaseDetails /></ProtectedRoute>} />
      <Route path="/cases/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><CaseEdit /></ProtectedRoute>} />
      <Route path="/evidence/create" element={<ProtectedRoute allowedRoles={['admin', 'officer']}><EvidenceCreate /></ProtectedRoute>} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}

export default App
