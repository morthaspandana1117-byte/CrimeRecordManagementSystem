import { useEffect, useMemo, useState } from 'react'
import DashboardSidebar from '../components/DashboardSidebar'
import { getAIEvaluationResults, getAIEvaluationSummary, runAIEvaluation } from '../services/aiEvaluationApi'

const emptySummary = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  criticalViolations: 0,
  passPercentage: 0,
}

const statusOptions = ['ALL', 'PASS', 'FAIL']
const severityOptions = ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

const formatStatus = (value) => value ? value.toUpperCase() : 'UNKNOWN'

function AIEvaluationDashboard() {
  const [summary, setSummary] = useState(emptySummary)
  const [results, setResults] = useState([])
  const [selectedResult, setSelectedResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [severityFilter, setSeverityFilter] = useState('ALL')

  const categoryOptions = useMemo(() => [
    'ALL',
    'Incorrect Extraction',
    'Missing Sources',
    'Unsupported Claims',
    'Access Boundary Violations',
    'Sensitive Data Handling',
  ], [])

  const loadSummary = async () => {
    try {
      const response = await getAIEvaluationSummary()
      setSummary(response.data?.data || emptySummary)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load evaluation summary.')
    }
  }

  const loadResults = async () => {
    try {
      setLoading(true)
      const params = {
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        severity: severityFilter !== 'ALL' ? severityFilter : undefined,
        search,
      }
      const response = await getAIEvaluationResults(params)
      const nextResults = response.data?.data || []
      setResults(nextResults)
      if (nextResults.length > 0 && !selectedResult) {
        setSelectedResult(nextResults[0])
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load evaluation results.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  useEffect(() => {
    loadResults()
  }, [categoryFilter, statusFilter, severityFilter, search])

  const handleRunEvaluation = async () => {
    try {
      setExecuting(true)
      setError('')
      const response = await runAIEvaluation()
      setSummary(response.data?.summary || emptySummary)
      const nextResults = response.data?.data || []
      setResults(nextResults)
      setSelectedResult(nextResults[0] || null)
      await loadSummary()
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to run evaluation.')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="AI Evaluation Dashboard" />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="container-fluid d-flex align-items-center justify-content-between gap-3 py-3">
            <div>
              <p className="header-kicker mb-0">CRMS / SAFEGUARDS</p>
              <h1 className="header-title mb-0">AI Evaluation Dashboard</h1>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleRunEvaluation}
              disabled={executing}
            >
              {executing ? 'Running evaluation...' : 'Run Evaluation'}
            </button>
          </div>
        </header>

        <main className="container-fluid py-4 py-md-5">
          <section className="row g-3 mb-4">
            {[
              { label: 'Total evaluation tests', value: summary.totalTests, key: 'totalTests' },
              { label: 'Passed tests', value: summary.passedTests, key: 'passedTests' },
              { label: 'Failed tests', value: summary.failedTests, key: 'failedTests' },
              { label: 'Critical safeguard violations', value: summary.criticalViolations, key: 'criticalViolations' },
              { label: 'Overall pass percentage', value: `${summary.passPercentage}%`, key: 'passPercentage' },
            ].map((card) => (
              <div className="col-12 col-md-6 col-xl" key={card.key}>
                <article className="stat-card h-100">
                  <p className="stat-label mb-2">{card.label}</p>
                  <p className="stat-value mb-0">{card.value}</p>
                </article>
              </div>
            ))}
          </section>

          <section className="card shadow-sm border-0 mb-4">
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label">Search</label>
                  <input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Test ID or description" />
                </div>
                <div className="col-md-2">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label">Severity</label>
                  <select className="form-select" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
                    {severityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <button className="btn btn-outline-secondary w-100" type="button" onClick={() => {
                    setSearch('')
                    setCategoryFilter('ALL')
                    setStatusFilter('ALL')
                    setSeverityFilter('ALL')
                  }}>Reset filters</button>
                </div>
              </div>
            </div>
          </section>

          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <div className="row g-4">
            <div className="col-lg-8">
              <section className="card shadow-sm border-0">
                <div className="card-body">
                  <h2 className="section-title mb-3">Evaluation Results</h2>
                  {loading ? (
                    <div className="dashboard-state" role="status">
                      <div className="spinner-border text-primary" aria-hidden="true" />
                      <p className="mb-0">Loading evaluation history...</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table align-middle">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Category</th>
                            <th>Expected</th>
                            <th>Status</th>
                            <th>Severity</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.length === 0 && (
                            <tr>
                              <td colSpan="6" className="text-center text-muted py-4">No evaluation results match the current filters.</td>
                            </tr>
                          )}
                          {results.map((result) => (
                            <tr key={result._id} onClick={() => setSelectedResult(result)} style={{ cursor: 'pointer' }}>
                              <td>{result.testCaseId}</td>
                              <td>{result.category}</td>
                              <td>{result.expectedBehavior}</td>
                              <td><span className={`badge ${result.status === 'PASS' ? 'bg-success' : 'bg-danger'}`}>{formatStatus(result.status)}</span></td>
                              <td><span className="badge bg-light text-dark">{result.severity}</span></td>
                              <td>{new Date(result.executedAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="col-lg-4">
              <section className="card shadow-sm border-0">
                <div className="card-body">
                  <h2 className="section-title mb-3">Detailed Result</h2>
                  {!selectedResult && <p className="text-muted mb-0">Select a result to inspect its details.</p>}
                  {selectedResult && (
                    <>
                      <p className="mb-1"><strong>{selectedResult.testCaseId}</strong></p>
                      <p className="mb-1 text-uppercase text-muted">{selectedResult.category}</p>
                      <p className="mb-3"><span className={`badge ${selectedResult.status === 'PASS' ? 'bg-success' : 'bg-danger'}`}>{formatStatus(selectedResult.status)}</span> · {selectedResult.severity}</p>

                      <div className="mb-3">
                        <h3 className="h6">Test input / scenario</h3>
                        <p className="mb-0 small text-muted">{selectedResult.testInput || 'Synthetic test fixture used for evaluation.'}</p>
                      </div>

                      <div className="mb-3">
                        <h3 className="h6">Expected safe behavior</h3>
                        <p className="mb-0 small">{selectedResult.expectedBehavior}</p>
                      </div>

                      <div className="mb-3">
                        <h3 className="h6">Actual behavior</h3>
                        <p className="mb-0 small">{selectedResult.actualBehavior}</p>
                      </div>

                      <div className="mb-3">
                        <h3 className="h6">Pass/fail explanation</h3>
                        <p className="mb-0 small">{selectedResult.failureReason || 'The evaluation passed and no failure reason was recorded.'}</p>
                      </div>

                      <div className="mb-3">
                        <h3 className="h6">Recommended corrective action</h3>
                        <p className="mb-0 small">{selectedResult.recommendedAction || 'No action required.'}</p>
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AIEvaluationDashboard
