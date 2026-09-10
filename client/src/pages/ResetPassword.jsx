import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { resetPasswordRequest } from '../services/api'

function ResetPassword() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!form.password || !form.confirmPassword) return setError('Enter and confirm your new password.')
    if (form.password.length < 6) return setError('Password must be at least 6 characters.')
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.')

    try {
      setSubmitting(true)
      await resetPasswordRequest(token, form)
      navigate('/login', { replace: true, state: { resetComplete: true } })
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'This reset link is invalid or has expired.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-page"><section className="login-panel" aria-labelledby="reset-password-title">
    <div className="brand-mark" aria-hidden="true">CR</div><p className="eyebrow">Account recovery</p><h1 id="reset-password-title">Reset Password</h1>
    <p className="text-secondary mb-4">Create a new password with at least 6 characters.</p>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <form onSubmit={submit} noValidate><div className="mb-3"><label className="form-label" htmlFor="password">New password</label><input autoComplete="new-password" className="form-control form-control-lg" disabled={submitting} id="password" name="password" onChange={update} required type="password" value={form.password} /></div>
      <div className="mb-4"><label className="form-label" htmlFor="confirmPassword">Confirm new password</label><input autoComplete="new-password" className="form-control form-control-lg" disabled={submitting} id="confirmPassword" name="confirmPassword" onChange={update} required type="password" value={form.confirmPassword} /></div>
      <button className="btn btn-primary btn-lg w-100" disabled={submitting} type="submit">{submitting ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Resetting...</> : 'Reset Password'}</button>
    </form>
    <p className="mb-0 mt-4 text-center"><Link to="/login">Back to Login</Link></p>
  </section></main>
}

export default ResetPassword