import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { approveOfficer, deactivateOfficer, getOfficers, rejectOfficer, updateOfficer } from '../services/api'
import { useAuth } from '../context/useAuth'

const ranks = ['Constable', 'Head Constable', 'ASI', 'SI', 'Inspector', 'DSP']
const departments = ['Cyber Crime', 'Criminal Investigation', 'Traffic', 'Law and Order']
const emptyForm = {
  username: '', email: '', password: '', officerId: '', badgeNumber: '', name: '', rank: ranks[0],
  department: departments[0], station: '', phoneNumber: '', address: '', joiningDate: '', status: 'active',
}
const formForOfficer = (officer) => officer ? {
  username: officer.userId?.username || '', email: officer.userId?.email || '', password: '',
  officerId: officer.officerId || '', badgeNumber: officer.badgeNumber || '', name: officer.name || '',
  rank: officer.rank || ranks[0], department: officer.department || departments[0], station: officer.station || '',
  phoneNumber: officer.phoneNumber || '', address: officer.address || '', joiningDate: dateInputValue(officer.joiningDate),
  status: officer.status || 'active',
} : emptyForm

const requestMessage = (error, fallback) => error.response?.data?.message || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')
const dateInputValue = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''

function OfficerForm({ editingOfficer, formRef, onCancel, onSaved }) {
  const [form, setForm] = useState(() => formForOfficer(editingOfficer))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isEditing = Boolean(editingOfficer)

  const changeField = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!isEditing && form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (isEditing && form.password && form.password.length < 8) {
      setError('New password must be at least 8 characters long.')
      return
    }
    const payload = { ...form, username: form.username.trim(), email: form.email.trim(), password: form.password || undefined }
    try {
      setSaving(true)
      if (!isEditing) return setError('Officer accounts must be created through the public registration page.')
      const response = await updateOfficer(editingOfficer._id, payload)
      onSaved(response.data.message || (isEditing ? 'Officer updated successfully.' : 'Officer created successfully.'))
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to save the officer.'))
    } finally {
      setSaving(false)
    }
  }

  return <section className="officer-form-card mb-4" aria-labelledby="officer-form-title" ref={formRef}>
    <div className="d-flex justify-content-between align-items-center gap-3 mb-3"><div><p className="eyebrow mb-1">Officer account</p><h2 className="section-title mb-0" id="officer-form-title">{isEditing ? 'Edit officer' : 'Create officer'}</h2></div>{isEditing && <button className="btn btn-outline-secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button>}</div>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <form onSubmit={submit} noValidate>
      <div className="row g-3">
        <Field label="Username" name="username" onChange={changeField} value={form.username} />
        <Field label="Email" name="email" onChange={changeField} type="email" value={form.email} />
        <Field help={isEditing ? 'Leave blank to keep the current password.' : 'At least 8 characters.'} label={isEditing ? 'New password (optional)' : 'Password'} name="password" onChange={changeField} required={!isEditing} type="password" value={form.password} />
        <Field label="Full name" name="name" onChange={changeField} value={form.name} />
        <Field label="Officer ID" name="officerId" onChange={changeField} value={form.officerId} />
        <Field label="Badge number" name="badgeNumber" onChange={changeField} value={form.badgeNumber} />
        <Select label="Rank" name="rank" onChange={changeField} options={ranks} value={form.rank} />
        <Select label="Department" name="department" onChange={changeField} options={departments} value={form.department} />
        <Field label="Station" name="station" onChange={changeField} value={form.station} />
        <Field label="Phone number" name="phoneNumber" onChange={changeField} value={form.phoneNumber} />
        <Field label="Joining date" name="joiningDate" onChange={changeField} type="date" value={form.joiningDate} />
        <Select label="Status" name="status" onChange={changeField} options={['active', 'inactive', 'suspended', 'retired']} value={form.status} />
        <div className="col-12"><label className="form-label" htmlFor="address">Address</label><textarea className="form-control" id="address" name="address" onChange={changeField} required rows="2" value={form.address} /></div>
      </div>
      <button className="btn btn-primary mt-4" disabled={saving} type="submit">{saving ? 'Saving...' : isEditing ? 'Save changes' : 'Create officer'}</button>
    </form>
  </section>
}

function Field({ help, label, name, onChange, required = true, type = 'text', value }) {
  return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><input className="form-control" id={name} name={name} onChange={onChange} required={required} type={type} value={value} />{help && <div className="form-text">{help}</div>}</div>
}

function Select({ label, name, onChange, options, value }) {
  return <div className="col-12 col-md-6"><label className="form-label" htmlFor={name}>{label}</label><select className="form-select" id={name} name={name} onChange={onChange} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
}

function OfficerManagement() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingOfficer, setEditingOfficer] = useState(null)
  const [deactivatingId, setDeactivatingId] = useState('')
  const formRef = useRef(null)

  const loadOfficers = useCallback(async () => {
    try { setLoading(true); setError(''); const response = await getOfficers(); setOfficers(response.data.data || []) }
    catch (requestError) { setError(requestMessage(requestError, 'Could not load officers.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { const timerId = window.setTimeout(loadOfficers, 0); return () => window.clearTimeout(timerId) }, [loadOfficers])
  useEffect(() => {
    if (showForm && editingOfficer) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showForm, editingOfficer])

  const startEdit = (officer) => { setEditingOfficer(officer); setShowForm(true); setNotice('') }
  const saved = async (message) => { setNotice(message); setShowForm(false); setEditingOfficer(null); await loadOfficers() }
  const deactivate = async (officer) => {
    if (!window.confirm(`Are you sure you want to deactivate this officer?\n\n${officer.name}`)) return
    try { setDeactivatingId(officer._id); setError(''); setNotice(''); const response = await deactivateOfficer(officer._id); setNotice(response.data.message || 'Officer deactivated successfully.'); await loadOfficers() }
    catch (requestError) { setError(requestMessage(requestError, 'Unable to deactivate the officer.')) }
    finally { setDeactivatingId('') }
  }
  const review = async (officer, action) => {
    try { setDeactivatingId(officer._id); setError(''); setNotice(''); const response = await (action === 'approve' ? approveOfficer(officer._id) : rejectOfficer(officer._id)); setNotice(response.data.message); await loadOfficers() }
    catch (requestError) { setError(requestMessage(requestError, 'Unable to review the officer registration.')) }
    finally { setDeactivatingId('') }
  }
  const logOut = () => { logout(); navigate('/login', { replace: true }) }

  return <div className="dashboard-page">
    <header className="dashboard-header"><div className="container d-flex align-items-center justify-content-between gap-3 py-3"><div className="d-flex align-items-center gap-3"><div className="brand-mark brand-mark-small" aria-hidden="true">CR</div><div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Officer Management</h1></div></div><div className="d-flex gap-2"><button className="btn btn-outline-light" onClick={() => navigate('/admin/dashboard')} type="button">Dashboard</button><button className="btn btn-outline-light" onClick={logOut} type="button">Log out</button></div></div></header>
    <main className="container py-4 py-md-5">
      <div className="d-flex align-items-end justify-content-between gap-3 mb-3"><div><p className="eyebrow mb-1">Officer Management</p><h2 className="section-title mb-0">Officer registrations</h2></div></div>
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {showForm && <OfficerForm editingOfficer={editingOfficer} formRef={formRef} key={editingOfficer?._id || 'new'} onCancel={() => { setShowForm(false); setEditingOfficer(null) }} onSaved={saved} />}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Loading officers...</p></div>}
      {!loading && !error && officers.length === 0 && <div className="dashboard-state"><p className="mb-3">No officer registrations have been submitted yet.</p></div>}
      {!loading && !error && officers.length > 0 && <div className="officer-table-card table-responsive"><table className="table table-hover align-middle"><thead><tr><th>Username</th><th>Officer</th><th>Contact</th><th>Rank / Department</th><th>Badge / ID</th><th>Approval</th><th>Actions</th></tr></thead><tbody>{officers.map((officer) => { const approval = officer.userId?.status || 'approved'; const active = officer.status === 'active' && officer.userId?.isActive !== false; return <tr key={officer._id}><td>{officer.userId?.username || 'Account unavailable'}</td><td>{officer.name}</td><td>{officer.userId?.email || '—'}</td><td><div>{officer.rank}</div><small className="text-secondary">{officer.department}</small></td><td><div>{officer.badgeNumber}</div><small className="text-secondary">{officer.officerId}</small></td><td><span className={`status-badge status-${approval}`}>{approval}</span></td><td><div className="d-flex gap-2">{approval === 'pending' && <><button className="btn btn-sm btn-primary" disabled={deactivatingId === officer._id} onClick={() => review(officer, 'approve')} type="button">Approve</button><button className="btn btn-sm btn-outline-danger" disabled={deactivatingId === officer._id} onClick={() => review(officer, 'reject')} type="button">Reject</button></>}<button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(officer)} type="button">Edit</button><button className="btn btn-sm btn-outline-danger" disabled={!active || deactivatingId === officer._id} onClick={() => deactivate(officer)} type="button">{deactivatingId === officer._id ? 'Working...' : 'Deactivate'}</button></div></td></tr> })}</tbody></table></div>}
    </main>
  </div>
}

export default OfficerManagement
