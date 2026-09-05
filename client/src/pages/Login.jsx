import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

const getLoginError = (error) => {
  if (!error.response) return 'Unable to reach the CRMS server. Ensure the backend is running and try again.'
  return error.response.data?.message || 'Login failed. Please try again.'
}

function Login() {
  const { login, isAuthenticated, loading, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const destinationFor = (authenticatedUser) => {
    const requested = location.state?.from?.pathname
    const defaultDestination = authenticatedUser.role === 'admin' ? '/admin/dashboard' : '/dashboard'
    const requestedIsAllowed = (authenticatedUser.role === 'admin' && requested === '/admin/dashboard') || (authenticatedUser.role === 'officer' && requested === '/dashboard')
    return requestedIsAllowed ? requested : defaultDestination
  }

  if (loading) {
    return <main className="page-loader" aria-label="Checking your session"><div className="spinner-border text-primary" role="status" /><span className="mt-3">Checking your secure session...</span></main>
  }

  if (!loading && isAuthenticated) return <Navigate to={user?.role === 'admin' ? '/admin/dashboard' : '/dashboard'} replace />

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((currentForm) => ({ ...currentForm, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    const username = form.username.trim()
    if (!username || !form.password) {
      setError('Enter both your username and password to continue.')
      return
    }
    try {
      setIsSubmitting(true)
      const authenticatedUser = await login({ username, password: form.password })
      navigate(destinationFor(authenticatedUser), { replace: true })
    } catch (requestError) {
      setError(getLoginError(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">CR</div>
        <p className="eyebrow">Secure officer portal</p>
        <h1 id="login-title">Crime Record Management System</h1>
        <p className="text-secondary mb-4">Sign in to access operational records and dashboard information.</p>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label" htmlFor="username">Username or email</label>
            <input autoComplete="username" className="form-control form-control-lg" disabled={isSubmitting} id="username" name="username" onChange={handleChange} placeholder="Enter your username or email" required value={form.username} />
          </div>
          <div className="mb-4">
            <label className="form-label" htmlFor="password">Password</label>
            <input autoComplete="current-password" className="form-control form-control-lg" disabled={isSubmitting} id="password" name="password" onChange={handleChange} placeholder="Enter your password" required type="password" value={form.password} />
          </div>
          <button className="btn btn-primary btn-lg w-100" disabled={isSubmitting} type="submit">
            {isSubmitting ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Signing in...</> : 'Sign in securely'}
          </button>
        </form>
        <p className="mb-0 mt-4 text-center text-secondary">Don&apos;t have an account? <Link to="/register">Register</Link></p>
      </section>
    </main>
  )
}

export default Login
