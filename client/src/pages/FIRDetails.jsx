import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getFIRById } from '../services/api'

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const formatDate = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

const getStatusClass = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'open') return 'status-badge status-approved'
  if (normalized === 'registered') return 'status-badge status-active'
  if (normalized === 'under investigation') return 'status-badge status-pending'
  if (normalized === 'charge sheet filed') return 'status-badge status-rejected'
  if (normalized === 'closed') return 'status-badge status-inactive'
  return 'status-badge'
}

const getFieldValue = (value) => value || 'Not available'

function FIRDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [fir, setFIR] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadFIR = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getFIRById(id)
      setFIR(response.data?.data || null)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to load FIR details.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFIR()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadFIR])

  if (loading) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">FIR Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/firs')} type="button">Back to FIR list</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading FIR details...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !fir) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">FIR Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/firs')} type="button">Back to FIR list</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="alert alert-danger" role="alert">{error || 'FIR not found.'}</div>
          <button className="btn btn-primary" onClick={loadFIR} type="button">Retry</button>
        </main>
      </div>
    )
  }

  const registeredBy = fir.registeredBy || {}
  const relatedCriminals = Array.isArray(fir.criminalIds) ? fir.criminalIds : []

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">FIR Details</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/firs')} type="button">Back to FIR list</button>
            <button className="btn btn-primary" onClick={() => navigate(`/firs/${fir._id}/edit`)} type="button">Edit FIR</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <section className="welcome-card mb-4">
          <div>
            <p className="eyebrow mb-1">FIR record</p>
            <h2 className="mb-1">{fir.firNo || 'Unknown FIR'}</h2>
            <p className="mb-0 text-secondary">Crime type: {fir.crimeType || 'Not available'}</p>
          </div>
          <span className={getStatusClass(fir.status)}>{fir.status || 'Unknown'}</span>
        </section>

        <div className="row g-4">
          <div className="col-12 col-lg-8">
            <div className="fir-detail-card mb-4">
              <div className="detail-section-header"><h3>FIR Information</h3></div>
              <div className="row g-3">
                <InfoField label="FIR number" value={fir.firNo} />
                <InfoField label="Date" value={formatDate(fir.date)} />
                <InfoField label="Police station" value={fir.policeStation} />
                <InfoField label="Crime type" value={fir.crimeType} />
                <InfoField label="Registered by" value={registeredBy?.name || registeredBy?.officerId || 'Not available'} />
                <InfoField label="Status" value={fir.status} valueClassName={getStatusClass(fir.status)} />
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Complaint text</span>
                    <strong>{getFieldValue(fir.complaint?.complaintText)}</strong>
                  </div>
                </div>
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Description</span>
                    <strong>{getFieldValue(fir.description)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-4">
            <div className="fir-detail-card mb-4">
              <div className="detail-section-header"><h3>Complaint</h3></div>
              <div className="row g-3">
                <InfoField label="Complainant" value={fir.complaint?.complainantName} />
                <InfoField label="Phone" value={fir.complaint?.complainantPhone} />
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Complaint summary</span>
                    <strong>{getFieldValue(fir.complaint?.complaintText)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="row g-4 mt-1">
          <div className="col-12 col-lg-6">
            <div className="fir-detail-card">
              <div className="detail-section-header"><h3>Location</h3></div>
              <div className="row g-3">
                <InfoField label="Address" value={fir.location?.address} />
                <InfoField label="City" value={fir.location?.city} />
                <InfoField label="State" value={fir.location?.state} />
                <InfoField label="Pincode" value={fir.location?.pincode} />
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="fir-detail-card">
              <div className="detail-section-header"><h3>Related criminals</h3></div>
              {relatedCriminals.length === 0 ? (
                <div className="empty-state-box"><p className="mb-0">No criminals linked to this FIR.</p></div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {relatedCriminals.map((criminal) => (
                    <div className="border rounded p-3" key={criminal._id || criminal.criminalId}>
                      <strong>{criminal.fullName || 'Unnamed criminal'}</strong>
                      <div className="small text-secondary">{criminal.criminalId || 'No ID'} · {criminal.status || 'Unknown status'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function InfoField({ label, value, valueClassName }) {
  return (
    <div className="col-12 col-md-6">
      <div className="detail-value-block">
        <span className="detail-label">{label}</span>
        {valueClassName ? <strong className={valueClassName}>{getFieldValue(value)}</strong> : <strong>{getFieldValue(value)}</strong>}
      </div>
    </div>
  )
}

export default FIRDetails
