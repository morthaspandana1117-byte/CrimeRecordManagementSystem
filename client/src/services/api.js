import axios from 'axios'

const TOKEN_STORAGE_KEY = 'crms_auth_token'
const DEFAULT_API_BASE_URL = typeof window !== 'undefined'
  ? `http://${window.location.hostname}:5000/api`
  : 'http://localhost:5000/api'

const api = axios.create({
  // In local development, prefer the current machine hostname so devices on the same LAN can reach the backend.
  baseURL: import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const apiError = error.response?.data?.error
    if (error.response?.status === 401 && ['TOKEN_REQUIRED', 'TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(apiError)) {
      window.dispatchEvent(new Event('crms:unauthorized'))
    }
    return Promise.reject(error)
  },
)

export const loginRequest = (credentials) => api.post('/auth/login', credentials)
export const forgotPasswordRequest = (email) => api.post('/auth/forgot-password', { email })
export const resetPasswordRequest = (token, passwords) => api.post(`/auth/reset-password/${encodeURIComponent(token)}`, passwords)
export const registerOfficer = (officer) => api.post('/auth/register', officer)
export const getCurrentUser = () => api.get('/auth/me')
export const getDashboardStats = () => api.get('/dashboard/stats')
export const getAdminDashboardStats = () => api.get('/dashboard/admin/stats')
export const getOfficers = (params = {}) => api.get('/officers', { params })
export const getOfficerById = (id) => api.get(`/officers/${id}`)
export const updateOfficer = (id, officer) => api.put(`/officers/${id}`, officer)
export const updateOfficerAccountStatus = (id, accountStatus) => api.patch(`/officers/${id}/status`, { accountStatus })
export const deactivateOfficer = (id) => api.patch(`/officers/${id}/status`, { accountStatus: 'inactive' })
export const approveOfficer = (id) => api.patch(`/officers/${id}/approve`)
export const rejectOfficer = (id) => api.patch(`/officers/${id}/reject`)
export const getAssignableOfficers = () => api.get('/officers/assignable')
export const getCriminals = (params = {}) => api.get('/criminals', { params })
export const getCriminalById = (id) => api.get(`/criminals/${id}`)
export const createCriminal = (criminal) => api.post('/criminals', criminal)
export const updateCriminal = (id, criminal) => api.put(`/criminals/${id}`, criminal)
export const updateCriminalStatus = (id, status) => api.patch(`/criminals/${id}/status`, { status })
export const getFIRs = (params = {}) => api.get('/firs', { params })
export const getFIRById = (id) => api.get(`/firs/${id}`)
export const createFIR = (fir) => api.post('/firs', fir)
export const updateFIR = (id, fir) => api.put(`/firs/${id}`, fir)
export const updateFIRStatus = (id, status) => api.patch(`/firs/${id}/status`, { status })
export const getCases = (params = {}) => api.get('/cases', { params })
export const getCaseById = (id) => api.get(`/cases/${id}`)
export const getCaseHistory = (id) => api.get(`/cases/${id}/history`)
export const createCase = (caseRecord) => api.post('/cases', caseRecord)
export const updateCase = (id, caseRecord) => api.put(`/cases/${id}`, caseRecord)
export const reopenCase = (id, reopenReason) => api.patch(`/cases/${id}/reopen`, { reopenReason })
export const getEvidence = (params = {}) => api.get('/evidence', { params })
export const createEvidence = (evidence) => api.post('/evidence', evidence)
export const getEvidenceById = (id) => api.get(`/evidence/${id}`)
export const downloadEvidence = (id) => api.get(`/evidence/${id}/download`)
export const verifyEvidence = (id, payload) => api.patch(`/evidence/${id}/verify`, payload)
export { TOKEN_STORAGE_KEY }
export default api
