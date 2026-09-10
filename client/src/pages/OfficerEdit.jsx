import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getOfficerById, updateOfficer } from '../services/api'

const ranks = ['Constable', 'Head Constable', 'ASI', 'SI', 'Inspector', 'DSP']
const departments = ['Cyber Crime', 'Criminal Investigation', 'Traffic', 'Law and Order']

const dateInputValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const requestMessage = (error, fallback) => error.response?.data?.message || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

function OfficerEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    username: '', email: '', password: '', officerId: '', badgeNumber: '', name: '', rank: ranks[0],
    department: departments[0], station: '', phoneNumber: '', address: '', joiningDate: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const loadOfficer = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getOfficerById(id)
      const officer = response.data?.data
      if (!officer) {
        setError('Officer not found.')
        return
      }
      setForm({
        username: officer.userId?.username || '',
        email: officer.userId?.email || '',
        password: '',
        officerId: officer.officerId || '',
        badgeNumber: officer.badgeNumber || '',
        name: officer.name || '',
        rank: officer.rank || ranks[0],
        department: officer.department || departments[0],
        station: officer.station || '',
        phoneNumber: officer.phoneNumber || '',
        address: officer.address || '',
        joiningDate: dateInputValue(officer.joiningDate),
      })
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to load officer details for editing.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOfficer()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadOfficer])

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    const username = form.username.trim()
    const email = form.email.trim()
    const password = form.password.trim()

    if (!username || !email || !form.officerId.trim() || !form.badgeNumber.trim() || !form.name.trim() || !form.rank || !form.department || !form.station.trim() || !form.phoneNumber.trim() || !form.address.trim() || !form.joiningDate) {
      setError('Please complete all required fields before saving.')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.')
      return
    }

    if (password && password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    const payload = {
      username,
      email,
      officerId: form.officerId.trim(),
      badgeNumber: form.badgeNumber.trim(),
      name: form.name.trim(),
      rank: form.rank,
      department: form.department,
      station: form.station.trim(),
      phoneNumber: form.phoneNumber.trim(),
      address: form.address.trim(),
      joiningDate: form.joiningDate,
      ...(password ? { password } : {}),
    }

    try {
      setSaving(true)
      const response = await updateOfficer(id, payload)
      setSuccessMessage(response.data?.message || 'Officer updated successfully.')
      window.setTimeout(() => navigate(`/officers/${id}`), 600)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to save officer changes.'))
    } finally {
      setSaving(false)
    }
  }

  const isDisabled = loading || saving

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">Update Officer</h1>
            </div>
          </div>
          <button className="btn btn-outline-light" onClick={() => navigate(`/officers/${id}`)} type="button">Back to details</button>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="officer-form-card mx-auto" style={{ maxWidth: '980px' }}>
          <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
            <div>
              <p className="eyebrow mb-1">Officer account</p>
              <h2 className="section-title mb-0">Edit officer</h2>
            </div>
            <button className="btn btn-outline-secondary" disabled={isDisabled} onClick={() => navigate(`/officers/${id}`)} type="button">Cancel</button>
          </div>

          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {successMessage && <div className="alert alert-success" role="status">{successMessage}</div>}

          {loading ? (
            <div className="dashboard-state" role="status">
              <div className="spinner-border text-primary" aria-hidden="true" />
              <p className="mb-0">Loading officer details...</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="username">Username</label>
                  <input className="form-control" id="username" name="username" onChange={updateField} required value={form.username} />
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="email">Email</label>
                  <input className="form-control" id="email" name="email" onChange={updateField} required type="email" value={form.email} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="password">New password (optional)</label>
                  <input className="form-control" id="password" minLength={6} name="password" onChange={updateField} type="password" value={form.password} />
                  <div className="form-text">Leave blank to keep the current password.</div>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="officerId">Officer ID</label>
                  <input className="form-control" id="officerId" name="officerId" onChange={updateField} required value={form.officerId} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="badgeNumber">Batch Number</label>
                  <input className="form-control" id="badgeNumber" name="badgeNumber" onChange={updateField} required value={form.badgeNumber} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="name">Full name</label>
                  <input className="form-control" id="name" name="name" onChange={updateField} required value={form.name} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="rank">Rank</label>
                  <select className="form-select" id="rank" name="rank" onChange={updateField} value={form.rank}>
                    {ranks.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="department">Department</label>
                  <select className="form-select" id="department" name="department" onChange={updateField} value={form.department}>
                    {departments.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="station">Police station</label>
                  <input className="form-control" id="station" name="station" onChange={updateField} required value={form.station} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="phoneNumber">Phone number</label>
                  <input className="form-control" id="phoneNumber" name="phoneNumber" onChange={updateField} required value={form.phoneNumber} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="joiningDate">Joining date</label>
                  <input className="form-control" id="joiningDate" name="joiningDate" onChange={updateField} required type="date" value={form.joiningDate} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="address">Address</label>
                  <textarea className="form-control" id="address" name="address" onChange={updateField} required rows="3" value={form.address} />
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-4">
                <button className="btn btn-outline-secondary" disabled={isDisabled} onClick={() => navigate(`/officers/${id}`)} type="button">Cancel</button>
                <button className="btn btn-primary" disabled={isDisabled} type="submit">{saving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

export default OfficerEdit
