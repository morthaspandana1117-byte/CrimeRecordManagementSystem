import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCases, getOfficerById } from '../services/api'

const formatDate = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

const getApprovalStatus = (officer) => officer?.userId?.status || 'approved'
const getAccountStatus = (officer) => {
  if (officer?.userId?.isActive === false || officer?.status === 'inactive') return 'inactive'
  return 'active'
}

const badgeClass = (status) => {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'pending') return 'status-badge status-pending'
  if (normalized === 'approved') return 'status-badge status-approved'
  if (normalized === 'rejected') return 'status-badge status-rejected'
  if (normalized === 'active') return 'status-badge status-active'
  if (normalized === 'inactive') return 'status-badge status-inactive'
  return 'status-badge'
}

function OfficerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [officer, setOfficer] = useState(null)
  const [assignedCases, setAssignedCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOfficerDetails = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const [officerResponse, casesResponse] = await Promise.all([
        getOfficerById(id),
        getCases(),
      ])

      const selectedOfficer = officerResponse.data?.data || null
      setOfficer(selectedOfficer)

      const currentOfficerId = selectedOfficer?._id
      const caseList = Array.isArray(casesResponse.data?.data) ? casesResponse.data.data : []
      const relevantCases = caseList.filter((caseItem) => {
        const assignedIds = Array.isArray(caseItem.assignedOfficerIds) ? caseItem.assignedOfficerIds : []
        return assignedIds.some((assigned) => {
          const assignedId = typeof assigned === 'string' ? assigned : assigned?._id
          return assignedId && currentOfficerId && assignedId.toString() === currentOfficerId.toString()
        })
      })
      setAssignedCases(relevantCases)
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'Unable to load officer details.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOfficerDetails()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadOfficerDetails])

  const approvalStatus = useMemo(() => getApprovalStatus(officer), [officer])
  const accountStatus = useMemo(() => getAccountStatus(officer), [officer])

  if (loading) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">Officer Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/officers')} type="button">Back to officers</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="dashboard-state" role="status">
            <div className="spinner-border text-primary" aria-hidden="true" />
            <p className="mb-0">Loading officer details...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !officer) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
            <div className="d-flex align-items-center gap-3">
              <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
              <div>
                <p className="header-kicker mb-0">CRMS</p>
                <h1 className="header-title mb-0">Officer Details</h1>
              </div>
            </div>
            <button className="btn btn-outline-light" onClick={() => navigate('/officers')} type="button">Back to officers</button>
          </div>
        </header>
        <main className="container py-4 py-md-5">
          <div className="alert alert-danger" role="alert">{error || 'Officer not found.'}</div>
          <button className="btn btn-primary" onClick={loadOfficerDetails} type="button">Retry</button>
        </main>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div>
              <p className="header-kicker mb-0">CRMS</p>
              <h1 className="header-title mb-0">Officer Details</h1>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/officers')} type="button">Back to Officer Management</button>
            <button className="btn btn-primary" onClick={() => navigate(`/officers/${officer._id}/edit`)} type="button">Edit Officer</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <section className="welcome-card mb-4">
          <div>
            <p className="eyebrow mb-1">Officer profile</p>
            <h2 className="mb-1">{officer.name}</h2>
            <p className="mb-0 text-secondary">{officer.rank} · {officer.department}</p>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <span className={badgeClass(approvalStatus)}>{approvalStatus}</span>
            <span className={badgeClass(accountStatus)}>{accountStatus}</span>
          </div>
        </section>

        <div className="row g-4">
          <div className="col-12 col-lg-7">
            <div className="officer-detail-card mb-4">
              <div className="detail-section-header">
                <h3>Officer Information</h3>
              </div>
              <div className="row g-3">
                <InfoField label="Full name" value={officer.name} />
                <InfoField label="Officer ID" value={officer.officerId} />
                <InfoField label="Batch Number" value={officer.badgeNumber} />
                <InfoField label="Rank" value={officer.rank} />
                <InfoField label="Department" value={officer.department} />
                <InfoField label="Police station" value={officer.station} />
                <InfoField label="Phone number" value={officer.phoneNumber} />
                <InfoField label="Joining date" value={formatDate(officer.joiningDate)} />
                <div className="col-12">
                  <div className="detail-value-block">
                    <span className="detail-label">Address</span>
                    <strong>{officer.address || 'Not available'}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-5">
            <div className="officer-detail-card mb-4">
              <div className="detail-section-header">
                <h3>Registration / Account Information</h3>
              </div>
              <div className="row g-3">
                <InfoField label="Username" value={officer.userId?.username || 'Not available'} />
                <InfoField label="Email" value={officer.userId?.email || 'Not available'} />
                <InfoField label="Registration date" value={formatDate(officer.createdAt)} />
                <InfoField label="Approval status" value={approvalStatus} valueClassName={badgeClass(approvalStatus)} />
                <InfoField label="Account status" value={accountStatus} valueClassName={badgeClass(accountStatus)} />
                <InfoField label="Account role" value={officer.userId?.role ? officer.userId.role.charAt(0).toUpperCase() + officer.userId.role.slice(1) : 'Officer'} />
              </div>
            </div>
          </div>
        </div>

        <div className="officer-detail-card mt-4">
          <div className="detail-section-header">
            <h3>Assigned Cases</h3>
          </div>

          {assignedCases.length === 0 ? (
            <div className="empty-state-box">
              <p className="mb-0">No cases are currently assigned to this officer.</p>
            </div>
          ) : (
            <div className="assigned-cases-list">
              {assignedCases.map((caseItem) => (
                <div className="assigned-case-item" key={caseItem._id}>
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <div>
                      <p className="case-title mb-1">{caseItem.title || 'Untitled case'}</p>
                      <small className="text-secondary">Case no: {caseItem.caseNo || 'Not available'}</small>
                    </div>
                    <span className="status-badge status-active">{caseItem.status || 'Open'}</span>
                  </div>
                  <div className="row g-2 mt-2">
                    <InfoField label="Priority" value={caseItem.priority || 'Not available'} />
                    <InfoField label="FIR number" value={caseItem.firId?.firNo || 'Not available'} />
                    <InfoField label="Start date" value={formatDate(caseItem.startDate)} />
                  </div>
                </div>
              ))}
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
        {valueClassName ? <strong className={valueClassName}>{value}</strong> : <strong>{value}</strong>}
      </div>
    </div>
  )
}

export default OfficerDetails
