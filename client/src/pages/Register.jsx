import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getActivePoliceStations, registerOfficer } from '../services/api'
import { officerRankOptions, officerRanks } from '../authority'

const ranks = officerRanks
const departments = ['Cyber Crime', 'Criminal Investigation', 'Traffic', 'Law and Order']
const initialForm = {
  username: '', email: '', batchNumber: '', officerId: '', name: '', rank: ranks[0],
  department: departments[0], stationId: '', phoneNumber: '', address: '', joiningDate: '',
}

function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stations, setStations] = useState([])
  const [loadingStations, setLoadingStations] = useState(true)
  const [stationError, setStationError] = useState('')
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  useEffect(() => {
    let active = true
    const loadStations = async () => {
      try {
        const response = await getActivePoliceStations()
        if (active) setStations(Array.isArray(response.data?.data) ? response.data.data : [])
      } catch (requestError) {
        if (active) {
          setStationError(requestError.response?.data?.message || (requestError.response
            ? 'Could not load active police stations. Please try again later.'
            : 'Unable to reach the CRMS server to load police stations.'))
        }
      } finally {
        if (active) setLoadingStations(false)
      }
    }

    void loadStations()
    return () => { active = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')

    const batchNumber = form.batchNumber.trim()
    if (!/^[A-Za-z0-9]{6}$/.test(batchNumber)) {
      return setError('Batch number must be exactly 6 alphanumeric characters.')
    }
    if (!form.stationId || !stations.some((station) => station._id === form.stationId)) {
      return setError('Select an active police station before submitting your registration.')
    }

    try {
      setSubmitting(true)
      const response = await registerOfficer({
        ...form,
        username: form.username.trim(),
        email: form.email.trim(),
        batchNumber,
        badgeNumber: batchNumber,
      })
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
    {stationError && <div className="alert alert-danger" role="alert">{stationError}</div>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    <form onSubmit={submit} noValidate><div className="row g-3">
      <Field label="Username" name="username" onChange={update} value={form.username} /><Field label="Email" name="email" onChange={update} type="email" value={form.email} />
      <Field help="Exactly 6 letters or numbers." label="Batch number" name="batchNumber" onChange={update} value={form.batchNumber} /><Field label="Full name" name="name" onChange={update} value={form.name} />
      <Field label="Officer ID" name="officerId" onChange={update} value={form.officerId} />
      <Select label="Rank" name="rank" onChange={update} options={officerRankOptions} value={form.rank} /><Select label="Department" name="department" onChange={update} options={departments} value={form.department} />
      <div className="col-12 col-md-6"><label className="form-label" htmlFor="stationId">Requested police station</label><select className="form-select" disabled={loadingStations || Boolean(stationError) || stations.length === 0} id="stationId" name="stationId" onChange={update} required value={form.stationId}><option value="">{loadingStations ? 'Loading active police stations...' : 'Select an active police station'}</option>{stations.map((station) => <option key={station._id} value={station._id}>{station.name}</option>)}</select>{loadingStations && <div className="form-text" role="status">Loading active police stations...</div>}{!loadingStations && !stationError && stations.length === 0 && <div className="form-text">No active police stations are available. Contact a system administrator.</div>}<div className="form-text">Your selection is a station request and will be confirmed when an administrator approves your registration.</div></div><Field label="Phone number" name="phoneNumber" onChange={update} value={form.phoneNumber} />
      <Field label="Joining date" name="joiningDate" onChange={update} type="date" value={form.joiningDate} /><div className="col-12"><label className="form-label" htmlFor="address">Address</label><textarea className="form-control" id="address" name="address" onChange={update} required rows="2" value={form.address} /></div>
    </div><button className="btn btn-primary btn-lg w-100 mt-4" disabled={submitting || Boolean(notice) || loadingStations || Boolean(stationError) || stations.length === 0 || !form.stationId} type="submit">{submitting ? 'Submitting...' : 'Submit registration'}</button></form>
    <p className="mb-0 mt-4 text-center text-secondary">Already have an account? <Link to="/login">Sign in</Link></p>
  </section></main>
}

function Field({ help, label, name, onChange, type = 'text', value }) { return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><input className="form-control" id={name} name={name} onChange={onChange} required type={type} value={value} />{help && <div className="form-text">{help}</div>}</div> }
function Select({ label, name, onChange, options, value }) { return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><select className="form-select" id={name} name={name} onChange={onChange} value={value}>{options.map((option) => { const item = typeof option === 'string' ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option> })}</select></div> }

export default Register
