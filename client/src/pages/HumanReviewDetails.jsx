import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { acceptHumanReviewSuggestion, correctHumanReviewSuggestion, getHumanReviewById, rejectHumanReviewSuggestion } from '../services/api'

function formatStatus(status) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Unknown'
}

function HumanReviewDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [suggestion, setSuggestion] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  const [correctedSuggestion, setCorrectedSuggestion] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refreshSuggestion = async () => {
    try {
      setLoading(true)
      const response = await getHumanReviewById(id)
      const data = response.data?.data || {}
      setSuggestion(data)
      setHistory(data.reviewHistory || [])
      setCorrectedSuggestion(data.correctedSuggestion || data.originalSuggestion || '')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load suggestion details.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshSuggestion()
  }, [id])

  const handleAccept = async () => {
    try {
      setSubmitting(true)
      setError('')
      await acceptHumanReviewSuggestion(id, { comments: reviewMessage })
      await refreshSuggestion()
      setReviewMessage('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to accept suggestion.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    try {
      setSubmitting(true)
      setError('')
      await rejectHumanReviewSuggestion(id, { reason: reviewMessage })
      await refreshSuggestion()
      setReviewMessage('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reject suggestion.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCorrect = async () => {
    try {
      setSubmitting(true)
      setError('')
      if (!reviewMessage || !correctedSuggestion.trim()) {
        setError('Correction explanation and corrected suggestion are required.')
        return
      }
      await correctHumanReviewSuggestion(id, { correctedSuggestion, comments: reviewMessage })
      await refreshSuggestion()
      setReviewMessage('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to correct suggestion.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="container py-5"><div className="spinner-border text-primary" role="status" /><span className="ms-2">Loading suggestion details...</span></div>
  }

  if (!suggestion) {
    return <div className="container py-5"><div className="alert alert-danger">{error || 'Suggestion not found.'}</div></div>
  }

  return (
    <div className="container py-5">
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <p className="text-uppercase text-muted mb-1">Review outcome</p>
          <h1 className="mb-0">Suggestion Details</h1>
        </div>
        <button className="btn btn-outline-secondary" type="button" onClick={() => navigate('/human-review')}>
          Back to dashboard
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="card mb-4">
            <div className="card-body">
              <h3 className="h5">Original AI-generated suggestion</h3>
              <p className="mb-3 text-muted">Source: {suggestion.sourceInfo}</p>
              <div className="bg-light rounded p-3">{suggestion.originalSuggestion}</div>
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-body">
              <h3 className="h5">Review decision</h3>
              <label className="form-label">Current status</label>
              <div className="mb-3"><span className="badge bg-primary">{formatStatus(suggestion.status)}</span></div>

              <label className="form-label">Editable corrected suggestion</label>
              <textarea className="form-control mb-3" rows="4" value={correctedSuggestion} onChange={(event) => setCorrectedSuggestion(event.target.value)} />

              <label className="form-label">Review comments / explanation</label>
              <textarea className="form-control mb-3" rows="3" value={reviewMessage} onChange={(event) => setReviewMessage(event.target.value)} placeholder="Add review explanation or reason" />

              <div className="d-flex flex-wrap gap-2">
                <button className="btn btn-success" type="button" disabled={submitting || suggestion.status !== 'PENDING'} onClick={handleAccept}>Accept suggestion</button>
                <button className="btn btn-warning" type="button" disabled={submitting || suggestion.status !== 'PENDING'} onClick={handleCorrect}>Correct suggestion</button>
                <button className="btn btn-danger" type="button" disabled={submitting || suggestion.status !== 'PENDING'} onClick={handleReject}>Reject suggestion</button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card mb-4">
            <div className="card-body">
              <h3 className="h5">Metadata</h3>
              <dl className="row mb-0">
                <dt className="col-6">Suggestion ID</dt>
                <dd className="col-6">{String(suggestion._id).slice(-8)}</dd>
                <dt className="col-6">Case ID</dt>
                <dd className="col-6">{String(suggestion.caseId).slice(-8)}</dd>
                <dt className="col-6">Type</dt>
                <dd className="col-6">{suggestion.suggestionType}</dd>
                <dt className="col-6">Model</dt>
                <dd className="col-6">{suggestion.aiModel || 'N/A'}</dd>
                <dt className="col-6">Generated</dt>
                <dd className="col-6">{suggestion.generatedAt ? new Date(suggestion.generatedAt).toLocaleString() : 'N/A'}</dd>
              </dl>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h3 className="h5">Review history</h3>
              {history.length === 0 && <p className="text-muted mb-0">No review history yet.</p>}
              <div className="d-flex flex-column gap-3 mt-3">
                {history.map((item) => (
                  <div key={item._id} className="border rounded p-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <strong>{item.actionPerformed}</strong>
                      <span className="badge bg-secondary">{item.newStatus}</span>
                    </div>
                    <p className="mb-1"><small>{item.reviewComments || 'No comments provided.'}</small></p>
                    <small className="text-muted">{item.reviewerRole || 'reviewer'} • {item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Not available'}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HumanReviewDetails
