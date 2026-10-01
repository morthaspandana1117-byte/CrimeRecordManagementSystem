import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCriminalById } from '../services/api'

const formatDate = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

const requestMessage = (error, fallback) => error.response?.data?.message || error.response?.data?.error || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

const getStatusClass = (value) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'active') return 'status-badge status-active'
  if (normalized === 'inactive') return 'status-badge status-inactive'
  if (normalized === 'wanted') return 'status-badge status-pending'
  if (normalized === 'arrested') return 'status-badge status-rejected'
  if (normalized === 'released') return 'status-badge status-approved'
  if (normalized === 'deceased') return 'status-badge status-inactive'
  return 'status-badge'
}

const getFieldValue = (value) => value || 'Not available'

function CriminalDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [criminal, setCriminal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadCriminal = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const response = await getCriminalById(id)
      setCriminal(response.data?.data || null)
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to load criminal details.'))
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

  if (loading) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">Criminal Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/criminals')} type="button">Back to Criminal List</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading criminal details...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !criminal) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">Criminal Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/criminals')} type="button">Back to Criminal List</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="alert alert-danger" role="alert">{error || 'Criminal not found.'}</div>
          <button className="btn btn-primary" onClick={loadCriminal} type="button">Retry</button>
        </main>
      </div>
    )
  }

  const identificationDetails = criminal.identificationDetails || {}

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">Criminal Details</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/criminals')} type="button">Back to Criminal List</button>
            <button className="btn btn-primary" onClick={() => navigate(`/criminals/${criminal._id}/edit`)} type="button">Edit Criminal</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <section className="welcome-card mb-4">
          <div>
            <p className="eyebrow mb-1">Criminal profile</p>
            <h2 className="mb-1">{criminal.fullName || 'Unnamed criminal'}</h2>
            <p className="mb-0 text-secondary">ID: {criminal.criminalId || 'Not available'}</p>
          </div>
          <span className={getStatusClass(criminal.status)}>{criminal.status ? criminal.status.charAt(0).toUpperCase() + criminal.status.slice(1) : 'Unknown'}</span>
        </section>

        <div className="row g-4">
          <div className="col-12 col-lg-8">
            <div className="officer-detail-card mb-4">
              <div className="detail-section-header">
                <h3>Criminal Information</h3>
              </div>
              <div className="row g-3">
                <InfoField label="Criminal ID" value={criminal.criminalId} />
                <InfoField label="Full name" value={criminal.fullName} />
                <InfoField label="Date of birth" value={formatDate(criminal.dateOfBirth)} />
                <InfoField label="Gender" value={criminal.gender} />
                <InfoField label="Phone number" value={criminal.phoneNumber} />
                <InfoField label="Status" value={criminal.status ? criminal.status.charAt(0).toUpperCase() + criminal.status.slice(1) : 'Unknown'} valueClassName={getStatusClass(criminal.status)} />
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Address</span>
                    <strong>{criminal.address || 'Not available'}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-4">
            <div className="officer-detail-card mb-4">
              <div className="detail-section-header">
                <h3>Identification</h3>
              </div>
              <div className="row g-3">
                <InfoField label="Type" value={identificationDetails.type || 'Not available'} />
                <InfoField label="Number" value={identificationDetails.number || 'Not available'} />
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Description</span>
                    <strong>{identificationDetails.description || 'Not available'}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="officer-detail-card mt-4">
          <div className="detail-section-header">
            <h3>Photograph</h3>
          </div>

          {criminal.photographUrl ? (
            <div className="photo-frame">
              <img alt={criminal.fullName || 'Criminal photograph'} src={criminal.photographUrl} />
            </div>
          ) : (
            <div className="empty-state-box">
              <p className="mb-0">No photograph available.</p>
            </div>
          )}
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

export default CriminalDetails
