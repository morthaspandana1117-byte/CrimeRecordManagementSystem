import { useEffect, useMemo, useState } from 'react'
import { getCurrentUser, loginRequest, TOKEN_STORAGE_KEY } from '../services/api'
import AuthContext from './authContext'

const USER_STORAGE_KEY = 'crms_auth_user'
const clearLegacyPersistentAuth = () => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
  } catch {
    // Session authentication continues even when browser storage is unavailable.
  }
}
const readStoredUser = () => {
  try {
    const savedUser = sessionStorage.getItem(USER_STORAGE_KEY)
    return savedUser ? JSON.parse(savedUser) : null
  } catch {
    sessionStorage.removeItem(USER_STORAGE_KEY)
    return null
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_STORAGE_KEY))
  const [user, setUser] = useState(readStoredUser)
  const [loading, setLoading] = useState(true)

  const clearAuth = () => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(USER_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    clearLegacyPersistentAuth()
  }, [])

  useEffect(() => {
    const handleUnauthorized = () => clearAuth()
    window.addEventListener('crms:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('crms:unauthorized', handleUnauthorized)
  }, [])

  useEffect(() => {
    let isMounted = true
    const restoreSession = async () => {
      if (!token) {
        if (isMounted) setLoading(false)
        return
      }
      try {
        const response = await getCurrentUser()
        if (!isMounted) return
        sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.data.data))
        setUser(response.data.data)
      } catch {
        if (isMounted) clearAuth()
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    restoreSession()
    return () => { isMounted = false }
  }, [token])

  const login = async (credentials) => {
    const response = await loginRequest(credentials)
    const { token: nextToken, user: nextUser } = response.data
    sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken)
    sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser))
    setToken(nextToken)
    setUser(nextUser)
    return nextUser
  }

  const value = useMemo(() => ({ user, token, loading, isAuthenticated: Boolean(token && user), login, logout: clearAuth }), [user, token, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
