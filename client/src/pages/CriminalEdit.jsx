import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCriminalById, updateCriminal } from '../services/api'

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const dateInputValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const initialForm = {
  criminalId: '',
  fullName: '',
  dateOfBirth: '',
  gender: 'Male',
  address: '',
  phoneNumber: '',
  identificationType: '',
  identificationNumber: '',
  identificationDescription: '',
  photographUrl: '',
  status: 'active',
}

function CriminalEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const loadCriminal = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getCriminalById(id)
      const criminal = response.data?.data
      if (!criminal) {
        setError('Criminal not found.')
        return
      }

      setForm({
        criminalId: criminal.criminalId || '',
        fullName: criminal.fullName || '',
        dateOfBirth: dateInputValue(criminal.dateOfBirth),
        gender: criminal.gender || 'Male',
        address: criminal.address || '',
        phoneNumber: criminal.phoneNumber || '',
        identificationType: criminal.identificationDetails?.type || '',
        identificationNumber: criminal.identificationDetails?.number || '',
        identificationDescription: criminal.identificationDetails?.description || '',
        photographUrl: criminal.photographUrl || criminal.photo || '',
        status: criminal.status || 'active',
      })
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to load criminal details for editing.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCriminal()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCriminal])

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const validate = () => {
    const requiredFields = [
      { key: 'criminalId', label: 'Criminal ID' },
      { key: 'fullName', label: 'Full name' },
      { key: 'dateOfBirth', label: 'Date of birth' },
      { key: 'gender', label: 'Gender' },
      { key: 'address', label: 'Address' },
      { key: 'status', label: 'Status' },
    ]

    for (const field of requiredFields) {
      if (!String(form[field.key] || '').trim()) {
        return `${field.label} is required.`
      }
    }

    if (!/^https?:\/\//i.test(String(form.photographUrl || '').trim()) && form.photographUrl.trim()) {
      return 'Photograph URL must start with http:// or https://.'
    }

    if (form.phoneNumber && !/^[0-9+\-\s()]{7,20}$/.test(form.phoneNumber.trim())) {
      return 'Phone number is not valid.'
    }

    if (new Date(form.dateOfBirth) > new Date()) {
      return 'Date of birth cannot be in the future.'
    }

    const hasIdentificationData = [form.identificationType, form.identificationNumber, form.identificationDescription].some((value) => value && value.trim())
    if (hasIdentificationData) {
      if (!form.identificationType.trim() || !form.identificationNumber.trim()) {
        return 'Identification type and number are required when identification details are provided.'
      }
    }

    return ''
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const payload = {
      criminalId: form.criminalId.trim(),
      fullName: form.fullName.trim(),
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      address: form.address.trim(),
      phoneNumber: form.phoneNumber.trim(),
      photographUrl: form.photographUrl.trim(),
      status: form.status,
      identificationDetails: {
        ...(form.identificationType.trim() ? { type: form.identificationType.trim() } : {}),
        ...(form.identificationNumber.trim() ? { number: form.identificationNumber.trim() } : {}),
        ...(form.identificationDescription.trim() ? { description: form.identificationDescription.trim() } : {}),
      },
    }

    if (Object.keys(payload.identificationDetails).length === 0) {
      payload.identificationDetails = undefined
    }

    try {
      setSaving(true)
      const response = await updateCriminal(id, payload)
      setSuccessMessage(response.data?.message || 'Criminal record updated successfully.')
      window.setTimeout(() => navigate(`/criminals/${id}`), 600)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to save criminal updates.'))
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
              <h1 className="header-title mb-0">Edit Criminal</h1>
            </div>
          </div>
          <button className="btn btn-outline-light" onClick={() => navigate(`/criminals/${id}`)} type="button">Back to details</button>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="criminal-form-card mx-auto" style={{ maxWidth: '980px' }}>
          <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
            <div>
              <p className="eyebrow mb-1">Criminal record</p>
              <h2 className="section-title mb-0">Edit criminal</h2>
            </div>
            <button className="btn btn-outline-secondary" disabled={isDisabled} onClick={() => navigate(`/criminals/${id}`)} type="button">Cancel</button>
          </div>

          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {successMessage && <div className="alert alert-success" role="status">{successMessage}</div>}

          {loading ? (
            <div className="dashboard-state" role="status">
              <div className="spinner-border text-primary" aria-hidden="true" />
              <p className="mb-0">Loading criminal details...</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="criminalId">Criminal ID</label>
                  <input className="form-control" id="criminalId" name="criminalId" onChange={updateField} required value={form.criminalId} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="fullName">Full name</label>
                  <input className="form-control" id="fullName" name="fullName" onChange={updateField} required value={form.fullName} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="dateOfBirth">Date of birth</label>
                  <input className="form-control" id="dateOfBirth" name="dateOfBirth" onChange={updateField} required type="date" value={form.dateOfBirth} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="gender">Gender</label>
                  <select className="form-select" id="gender" name="gender" onChange={updateField} value={form.gender}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="status">Status</label>
                  <select className="form-select" id="status" name="status" onChange={updateField} value={form.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="wanted">Wanted</option>
                    <option value="arrested">Arrested</option>
                    <option value="released">Released</option>
                    <option value="deceased">Deceased</option>
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="phoneNumber">Phone number</label>
                  <input className="form-control" id="phoneNumber" name="phoneNumber" onChange={updateField} value={form.phoneNumber} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="address">Address</label>
                  <textarea className="form-control" id="address" name="address" onChange={updateField} required rows="3" value={form.address} />
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="identificationType">Identification type</label>
                  <input className="form-control" id="identificationType" name="identificationType" onChange={updateField} value={form.identificationType} />
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="identificationNumber">Identification number</label>
                  <input className="form-control" id="identificationNumber" name="identificationNumber" onChange={updateField} value={form.identificationNumber} />
                </div>

                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="identificationDescription">Identification note</label>
                  <input className="form-control" id="identificationDescription" name="identificationDescription" onChange={updateField} value={form.identificationDescription} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="photographUrl">Photograph URL</label>
                  <input className="form-control" id="photographUrl" name="photographUrl" onChange={updateField} type="url" value={form.photographUrl} />
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-4">
                <button className="btn btn-outline-secondary" disabled={isDisabled} onClick={() => navigate(`/criminals/${id}`)} type="button">Cancel</button>
                <button className="btn btn-primary" disabled={isDisabled} type="submit">{saving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

export default CriminalEdit
