import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { registerOfficer } from '../services/api'

const ranks = ['Constable', 'Head Constable', 'ASI', 'SI', 'Inspector', 'DSP']
const departments = ['Cyber Crime', 'Criminal Investigation', 'Traffic', 'Law and Order']
const initialForm = {
  username: '', email: '', password: '', officerId: '', badgeNumber: '', name: '', rank: ranks[0],
  department: departments[0], station: '', phoneNumber: '', address: '', joiningDate: '',
}

function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (form.password.length < 8) return setError('Password must be at least 8 characters long.')
    try {
      setSubmitting(true)
      const response = await registerOfficer({ ...form, username: form.username.trim(), email: form.email.trim() })
      setNotice(response.data.message || 'Registration submitted for admin approval.')
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    } catch (requestError) {
      setError(requestError.response?.data?.message || (requestError.response ? 'Unable to register. Please review your details.' : 'Unable to reach the CRMS server. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-page"><section className="login-panel register-panel" aria-labelledby="register-title">
    <div className="brand-mark" aria-hidden="true">CR</div><p className="eyebrow">Officer registration</p><h1 id="register-title">Request an officer account</h1>
    <p className="text-secondary mb-4">All officer registrations are reviewed by an administrator before sign-in is enabled.</p>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    <form onSubmit={submit} noValidate><div className="row g-3">
      <Field label="Username" name="username" onChange={update} value={form.username} /><Field label="Email" name="email" onChange={update} type="email" value={form.email} />
      <Field help="At least 8 characters." label="Password" name="password" onChange={update} type="password" value={form.password} /><Field label="Full name" name="name" onChange={update} value={form.name} />
      <Field label="Officer ID" name="officerId" onChange={update} value={form.officerId} /><Field label="Badge number" name="badgeNumber" onChange={update} value={form.badgeNumber} />
      <Select label="Rank" name="rank" onChange={update} options={ranks} value={form.rank} /><Select label="Department" name="department" onChange={update} options={departments} value={form.department} />
      <Field label="Station" name="station" onChange={update} value={form.station} /><Field label="Phone number" name="phoneNumber" onChange={update} value={form.phoneNumber} />
      <Field label="Joining date" name="joiningDate" onChange={update} type="date" value={form.joiningDate} /><div className="col-12"><label className="form-label" htmlFor="address">Address</label><textarea className="form-control" id="address" name="address" onChange={update} required rows="2" value={form.address} /></div>
    </div><button className="btn btn-primary btn-lg w-100 mt-4" disabled={submitting || Boolean(notice)} type="submit">{submitting ? 'Submitting...' : 'Submit registration'}</button></form>
    <p className="mb-0 mt-4 text-center text-secondary">Already have an account? <Link to="/login">Sign in</Link></p>
  </section></main>
}

function Field({ help, label, name, onChange, type = 'text', value }) { return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><input className="form-control" id={name} name={name} onChange={onChange} required type={type} value={value} />{help && <div className="form-text">{help}</div>}</div> }
function Select({ label, name, onChange, options, value }) { return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><select className="form-select" id={name} name={name} onChange={onChange} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div> }

export default Register
