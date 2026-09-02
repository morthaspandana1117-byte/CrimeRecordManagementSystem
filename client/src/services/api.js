import axios from 'axios'

const TOKEN_STORAGE_KEY = 'crms_auth_token'

const api = axios.create({
  // The server defaults to port 5000. A VITE_API_BASE_URL value can override it.
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
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
export const getCurrentUser = () => api.get('/auth/me')
export const getDashboardStats = () => api.get('/dashboard/stats')
export const getOfficers = () => api.get('/officers')
export const createOfficer = (officer) => api.post('/officers', officer)
export const updateOfficer = (id, officer) => api.put(`/officers/${id}`, officer)
export const deactivateOfficer = (id) => api.patch(`/officers/${id}/deactivate`)
export { TOKEN_STORAGE_KEY }
export default api
