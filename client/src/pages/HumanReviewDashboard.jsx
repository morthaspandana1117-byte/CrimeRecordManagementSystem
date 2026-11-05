import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardSidebar from '../components/DashboardSidebar'
import { getHumanReviewSuggestions } from '../services/api'

const emptySummary = {
  total: 0,
  pending: 0,
  accepted: 0,
  corrected: 0,
  rejected: 0,
}

function formatStatus(status) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Unknown'
}

function HumanReviewDashboard() {
  const navigate = useNavigate()
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const loadSuggestions = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await getHumanReviewSuggestions({ page: 1, limit: 25 })
        if (active) {
          setSuggestions(response.data?.data || [])
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.response?.data?.message || 'Unable to load AI review suggestions.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadSuggestions()
    return () => {
      active = false
    }
  }, [])

  const summary = useMemo(() => {
    const nextSummary = { ...emptySummary }
    suggestions.forEach((suggestion) => {
      nextSummary.total += 1
      if (suggestion.status === 'PENDING') nextSummary.pending += 1
      if (suggestion.status === 'ACCEPTED') nextSummary.accepted += 1
      if (suggestion.status === 'CORRECTED') nextSummary.corrected += 1
      if (suggestion.status === 'REJECTED') nextSummary.rejected += 1
    })
    return nextSummary
  }, [suggestions])

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="Human Review Dashboard" />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="container-fluid d-flex align-items-center justify-content-between gap-3 py-3">
            <div>
              <p className="header-kicker mb-0">CRMS / REVIEW WORKFLOW</p>
              <h1 className="header-title mb-0">Human Review Controls</h1>
            </div>
          </div>
        </header>

        <main className="container-fluid py-4 py-md-5">
          <section className="row g-3 mb-4">
            {[
              { key: 'total', label: 'Total AI Suggestions', value: summary.total },
              { key: 'pending', label: 'Pending', value: summary.pending },
              { key: 'accepted', label: 'Accepted', value: summary.accepted },
              { key: 'corrected', label: 'Corrected', value: summary.corrected },
              { key: 'rejected', label: 'Rejected', value: summary.rejected },
            ].map((card) => (
              <div className="col-12 col-md-6 col-xl" key={card.key}>
                <article className="stat-card h-100">
                  <p className="stat-label mb-2">{card.label}</p>
                  <p className="stat-value mb-0">{card.value}</p>
                </article>
              </div>
            ))}
          </section>

          <section className="card shadow-sm border-0">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                <div>
                  <h2 className="section-title mb-0">AI Suggestions</h2>
                </div>
                <button className="btn btn-primary" type="button" onClick={() => navigate('/cases')}>
                  Review cases
                </button>
              </div>

              {loading && (
                <div className="dashboard-state" role="status">
                  <div className="spinner-border text-primary" aria-hidden="true" />
                  <p className="mb-0">Loading review queue...</p>
                </div>
              )}

              {!loading && error && (
                <div className="alert alert-danger" role="alert">{error}</div>
              )}

              {!loading && !error && (
                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th>Suggestion ID</th>
                        <th>Case ID</th>
                        <th>Type</th>
                        <th>AI Generated Suggestion</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Generated Date</th>
                        <th>Review Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.length === 0 && (
                        <tr>
                          <td colSpan="8" className="text-center text-muted py-4">No AI suggestions available.</td>
                        </tr>
                      )}
                      {suggestions.map((suggestion) => (
                        <tr key={suggestion._id}>
                          <td>{String(suggestion._id).slice(-8)}</td>
                          <td>{String(suggestion.caseId).slice(-8)}</td>
                          <td>{suggestion.suggestionType}</td>
                          <td>{suggestion.originalSuggestion}</td>
                          <td>
                            <span className="badge bg-light text-dark">{formatStatus(suggestion.status)}</span>
                          </td>
                          <td>{suggestion.sourceInfo}</td>
                          <td>{new Date(suggestion.generatedAt).toLocaleDateString()}</td>
                          <td>
                            <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => navigate(`/human-review/${suggestion._id}`)}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default HumanReviewDashboard
