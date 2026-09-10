import { useEffect, useState } from 'react'
import { getAssignableOfficers } from '../services/api'

function OfficerAssignmentSelector({ value = [], onChange, disabled = false }) {
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadAssignableOfficers = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await getAssignableOfficers()
        if (!isMounted) return
        setOfficers(Array.isArray(response.data?.data) ? response.data.data : [])
      } catch (requestError) {
        if (!isMounted) return
        setError(requestError.response?.data?.message || 'Unable to load assignable officers.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadAssignableOfficers()
    return () => { isMounted = false }
  }, [])

  const selectedIds = new Set((value || []).map((id) => String(id)))

  const toggleOfficer = (officerId) => {
    if (disabled) return
    const nextValue = selectedIds.has(String(officerId))
      ? (value || []).filter((id) => String(id) !== String(officerId))
      : [...(value || []), officerId]
    onChange?.(nextValue)
  }

  const removeOfficer = (officerId) => {
    if (disabled) return
    onChange?.((value || []).filter((id) => String(id) !== String(officerId)))
  }

  if (loading) {
    return <div className="dashboard-state"><div className="spinner-border text-primary" aria-hidden="true" /><p className="mb-0">Loading assignable officers...</p></div>
  }

  if (error) {
    return <div className="alert alert-warning mb-0" role="alert">{error}</div>
  }

  return (
    <div className="assignment-selector-card">
      <div className="d-flex justify-content-between align-items-center gap-3 mb-3">
        <h5 className="mb-0">Assignable Officers</h5>
        <span className="badge bg-light text-dark">{officers.length} eligible</span>
      </div>

      {officers.length === 0 ? (
        <div className="alert alert-info mb-0">No officer is currently eligible for case assignment.</div>
      ) : (
        <div className="row g-2">
          {officers.map((officer) => {
            const isSelected = selectedIds.has(String(officer._id))
            return (
              <div className="col-12 col-md-6" key={officer._id}>
                <button
                  className={`assignment-option ${isSelected ? 'selected' : ''}`}
                  disabled={disabled}
                  onClick={() => toggleOfficer(officer._id)}
                  type="button"
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <strong>{officer.name}</strong>
                      <div className="small text-secondary">{officer.username || 'No username'} · {officer.badgeNumber}</div>
                    </div>
                    <span className="badge bg-secondary">{officer.rank}</span>
                  </div>
                  <div className="small text-secondary mt-2">{officer.department} · {officer.station}</div>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {value && value.length > 0 && (
        <div className="mt-3">
          <h6 className="mb-2">Selected officers</h6>
          <div className="selected-assignment-list">
            {value.map((officerId) => {
              const officer = officers.find((entry) => String(entry._id) === String(officerId))
              if (!officer) return null
              return (
                <span className="selected-assignment-item" key={officerId}>
                  {officer.name}
                  <button className="btn-close" onClick={() => removeOfficer(officerId)} type="button" aria-label={`Remove ${officer.name}`} />
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default OfficerAssignmentSelector
