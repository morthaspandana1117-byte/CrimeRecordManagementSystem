import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { createFIR, getAssignableOfficers, getCriminals } from '../services/api'

const initialForm = {
  firNo: '',
  date: '',
  policeStation: '',
  complainantName: '',
  complainantPhone: '',
  complaintText: '',
  description: '',
  crimeType: 'Theft',
  address: '',
  city: '',
  state: '',
  pincode: '',
  registeredBy: '',
  criminalIds: [],
  status: 'Open',
}

const validCrimeTypes = ['Theft', 'Robbery', 'Murder', 'Assault', 'Kidnapping', 'Fraud', 'Cyber Crime', 'Drug Offense', 'Sexual Offense', 'Property Crime', 'Other']
const validStatuses = ['Open', 'Registered', 'Under Investigation', 'Charge Sheet Filed', 'Closed']

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

function FIRCreate() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [officerOptions, setOfficerOptions] = useState([])
  const [criminalOptions, setCriminalOptions] = useState([])

  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true)
        const [officersResponse, criminalsResponse] = await Promise.all([
          user?.role === 'admin' ? getAssignableOfficers() : Promise.resolve({ data: { data: [] } }),
          getCriminals({ limit: 100 }),
        ])

        if (user?.role === 'admin') {
          setOfficerOptions(Array.isArray(officersResponse.data?.data) ? officersResponse.data.data : [])
        }
        setCriminalOptions(Array.isArray(criminalsResponse.data?.data) ? criminalsResponse.data.data : [])
      } catch (requestError) {
        setError(requestMessage(requestError, 'Unable to load FIR form options.'))
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [user])

  const updateField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const toggleCriminal = (criminalId) => {
    setForm((current) => {
      const selected = current.criminalIds || []
      const nextSelected = selected.includes(criminalId)
        ? selected.filter((value) => value !== criminalId)
        : [...selected, criminalId]
      return { ...current, criminalIds: nextSelected }
    })
  }

  const validate = () => {
    if (!form.firNo.trim()) return 'FIR number is required.'
    if (!form.date) return 'FIR date is required.'
    if (!form.policeStation.trim()) return 'Police station is required.'
    if (!form.complainantName.trim()) return 'Complainant name is required.'
    if (!form.complaintText.trim()) return 'Complaint text is required.'
    if (!form.description.trim()) return 'Description is required.'
    if (!form.crimeType.trim()) return 'Crime type is required.'
    if (!form.address.trim() || !form.city.trim() || !form.state.trim() || !form.pincode.trim()) return 'Location address, city, state, and pincode are required.'
    if (user?.role === 'admin' && !form.registeredBy) return 'Please select an eligible officer for this FIR.'
    if (!form.criminalIds.length) return 'Select at least one criminal linked to this FIR.'
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
      firNo: form.firNo.trim(),
      date: form.date,
      policeStation: form.policeStation.trim(),
      complaint: {
        complainantName: form.complainantName.trim(),
        complainantPhone: form.complainantPhone.trim(),
        complaintText: form.complaintText.trim(),
      },
      description: form.description.trim(),
      crimeType: form.crimeType,
      location: {
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
      },
      registeredBy: user?.role === 'admin' ? form.registeredBy : undefined,
      criminalIds: form.criminalIds,
      status: form.status,
    }

    try {
      setLoading(true)
      const response = await createFIR(payload)
      setSuccessMessage(response.data?.message || 'FIR created successfully.')
      window.setTimeout(() => navigate('/firs'), 600)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to create FIR record.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">Create FIR</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/firs')} type="button">Back to list</button>
            <button className="btn btn-outline-light" onClick={() => { logout(); navigate('/login', { replace: true }) }} type="button">Log out</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="fir-form-card mx-auto" style={{ maxWidth: '980px' }}>
          <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
            <div>
              <p className="eyebrow mb-1">FIR registration</p>
              <h2 className="section-title mb-0">Create FIR</h2>
            </div>
            <button className="btn btn-outline-secondary" disabled={loading} onClick={() => navigate('/firs')} type="button">Cancel</button>
          </div>

          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {successMessage && <div className="alert alert-success" role="status">{successMessage}</div>}

          {loadingOptions ? (
            <div className="dashboard-state" role="status">
              <div className="spinner-border text-primary" aria-hidden="true" />
              <p className="mb-0">Loading FIR form data...</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="firNo">FIR number</label>
                  <input className="form-control" id="firNo" name="firNo" onChange={updateField} required value={form.firNo} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="date">FIR date</label>
                  <input className="form-control" id="date" name="date" onChange={updateField} required type="date" value={form.date} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="policeStation">Police station</label>
                  <input className="form-control" id="policeStation" name="policeStation" onChange={updateField} required value={form.policeStation} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="crimeType">Crime type</label>
                  <select className="form-select" id="crimeType" name="crimeType" onChange={updateField} value={form.crimeType}>
                    {validCrimeTypes.map((crimeType) => (
                      <option key={crimeType} value={crimeType}>{crimeType}</option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="status">Status</label>
                  <select className="form-select" id="status" name="status" onChange={updateField} value={form.status}>
                    {validStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                {user?.role === 'admin' && (
                  <div className="col-12 col-md-6">
                    <label className="form-label" htmlFor="registeredBy">Registered by officer</label>
                    <select className="form-select" id="registeredBy" name="registeredBy" onChange={updateField} value={form.registeredBy}>
                      <option value="">Select an employee officer</option>
                      {officerOptions.map((officer) => (
                        <option key={officer._id} value={officer._id}>{officer.name} ({officer.badgeNumber || officer.station || 'Officer'})</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="col-12">
                  <label className="form-label" htmlFor="complainantName">Complainant name</label>
                  <input className="form-control" id="complainantName" name="complainantName" onChange={updateField} required value={form.complainantName} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="complainantPhone">Complainant phone</label>
                  <input className="form-control" id="complainantPhone" name="complainantPhone" onChange={updateField} placeholder="Optional" value={form.complainantPhone} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="complaintText">Complaint details</label>
                  <textarea className="form-control" id="complaintText" name="complaintText" onChange={updateField} required rows="3" value={form.complaintText} />
                </div>

                <div className="col-12">
                  <label className="form-label" htmlFor="description">Case description</label>
                  <textarea className="form-control" id="description" name="description" onChange={updateField} required rows="3" value={form.description} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="address">Address</label>
                  <input className="form-control" id="address" name="address" onChange={updateField} required value={form.address} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="city">City</label>
                  <input className="form-control" id="city" name="city" onChange={updateField} required value={form.city} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="state">State</label>
                  <input className="form-control" id="state" name="state" onChange={updateField} required value={form.state} />
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label" htmlFor="pincode">Pincode</label>
                  <input className="form-control" id="pincode" name="pincode" onChange={updateField} required value={form.pincode} />
                </div>

                <div className="col-12">
                  <label className="form-label">Related criminals</label>
                  <div className="row g-2">
                    {criminalOptions.length === 0 ? (
                      <div className="col-12">
                        <div className="alert alert-info mb-0">No criminal records are currently available for selection.</div>
                      </div>
                    ) : (
                      criminalOptions.map((criminal) => {
                        const isSelected = form.criminalIds.includes(criminal._id)
                        return (
                          <div className="col-12 col-md-6" key={criminal._id}>
                            <button
                              className={`btn w-100 ${isSelected ? 'btn-primary' : 'btn-outline-secondary'}`}
                              onClick={() => toggleCriminal(criminal._id)}
                              type="button"
                            >
                              {criminal.fullName || 'Unnamed criminal'} ({criminal.criminalId || 'No ID'})
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-4">
                <button className="btn btn-outline-secondary" disabled={loading} onClick={() => navigate('/firs')} type="button">Cancel</button>
                <button className="btn btn-primary" disabled={loading} type="submit">{loading ? 'Creating...' : 'Create FIR'}</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

export default FIRCreate
