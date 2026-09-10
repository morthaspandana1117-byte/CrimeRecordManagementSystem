import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPasswordRequest } from '../services/api'

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const normalizedEmail = email.trim()
    if (!normalizedEmail) return setError('Enter your registered email address.')

    try {
      setSubmitting(true)
      const response = await forgotPasswordRequest(normalizedEmail)
      setNotice(response.data.message || 'If an account exists, reset instructions have been sent.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to send reset instructions. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-page"><section className="login-panel" aria-labelledby="forgot-password-title">
    <div className="brand-mark" aria-hidden="true">CR</div><p className="eyebrow">Account recovery</p><h1 id="forgot-password-title">Forgot Password</h1>
    <p className="text-secondary mb-4">Enter your registered email address and we&apos;ll send instructions to reset your password.</p>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    <form onSubmit={submit} noValidate><div className="mb-4"><label className="form-label" htmlFor="email">Email address</label><input autoComplete="email" className="form-control form-control-lg" disabled={submitting} id="email" name="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} /></div>
      <button className="btn btn-primary btn-lg w-100" disabled={submitting} type="submit">{submitting ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Sending...</> : 'Send Reset Link'}</button>
    </form>
    <p className="mb-0 mt-4 text-center"><Link to="/login">Back to Login</Link></p>
  </section></main>
}

export default ForgotPassword