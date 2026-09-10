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
export const getOfficers = () => api.get('/officers')
export const updateOfficer = (id, officer) => api.put(`/officers/${id}`, officer)
export const deactivateOfficer = (id) => api.patch(`/officers/${id}/deactivate`)
export const approveOfficer = (id) => api.patch(`/officers/${id}/approve`)
export const rejectOfficer = (id) => api.patch(`/officers/${id}/reject`)
export { TOKEN_STORAGE_KEY }
export default api
