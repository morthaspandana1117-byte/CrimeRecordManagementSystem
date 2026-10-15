import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isSeniorOfficer } from '../authority'
import { useAuth } from '../context/useAuth'
import {
  exportReport,
  getCrimeStatistics,
  getMonthlyReport,
  getOfficerPerformance,
  getSubordinateOfficers,
} from '../services/api'

const reportTabs = [
  { id: 'crime-statistics', label: 'Crime statistics' },
  { id: 'monthly', label: 'Monthly report' },
  { id: 'officer-performance', label: 'Officer performance' },
]

const crimeTypes = [
  'Theft',
  'Robbery',
  'Murder',
  'Assault',
  'Kidnapping',
  'Fraud',
  'Cyber Crime',
  'Drug Offense',
  'Sexual Offense',
  'Property Crime',
  'Other',
]

const firStatuses = ['Open', 'Registered', 'Under Investigation', 'Charge Sheet Filed', 'Closed']
const currentMonth = () => new Date().toISOString().slice(0, 7)
const initialQueries = () => ({
  'crime-statistics': {},
  monthly: { month: currentMonth() },
  'officer-performance': {},
})

const getErrorMessage = async (error, fallback) => {
  const responseData = error.response?.data
  if (responseData instanceof Blob) {
    try {
      const payload = JSON.parse(await responseData.text())
      return payload.message || fallback
    } catch {
      return fallback
    }
  }
  return responseData?.message || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')
}

const formatNumber = (value) => Number(value || 0).toLocaleString()

function ReportTable({ title, columns, rows }) {
  return (
    <section className="report-table-card mb-4" aria-label={title}>
      <div className="p-3 p-md-4">
        <h3 className="h5 section-title mb-3">{title}</h3>
        {rows.length === 0
          ? <p className="text-secondary mb-0">No records matched the selected filters.</p>
          : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${title}-${index}`}>
                      {columns.map((column) => <td key={column.key}>{row[column.key] ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </section>
  )
}

function ReportMetric({ label, value }) {
  return (
    <div className="col-12 col-sm-6 col-lg-3">
      <article className="stat-card h-100">
        <p className="stat-label mt-0">{label}</p>
        <p className="stat-value">{formatNumber(value)}</p>
      </article>
    </div>
  )
}

function Reports() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [activeReport, setActiveReport] = useState('crime-statistics')
  const [queries, setQueries] = useState(initialQueries)
  const [draft, setDraft] = useState({
    fromDate: '',
    toDate: '',
    crimeType: '',
    status: '',
    city: '',
    state: '',
    pincode: '',
    month: currentMonth(),
    officerId: '',
  })
  const [reportData, setReportData] = useState({})
  const [reportErrors, setReportErrors] = useState({})
  const [loadingReport, setLoadingReport] = useState('')
  const [exporting, setExporting] = useState('')
  const [exportSuccess, setExportSuccess] = useState('')
  const [subordinates, setSubordinates] = useState(null)
  const [subordinatesError, setSubordinatesError] = useState('')
  const [loadingSubordinates, setLoadingSubordinates] = useState(false)
  const requestController = useRef(null)
  const exportController = useRef(null)
  const subordinateController = useRef(null)
  const busyRef = useRef(false)
  const exportBusyRef = useRef(false)
  const subordinateRequestRef = useRef(false)

  const loadReport = useCallback(async (type, params) => {
    if (busyRef.current) return
    busyRef.current = true
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoadingReport(type)
    setReportErrors((current) => ({ ...current, [type]: '' }))
    setReportData((current) => ({ ...current, [type]: null }))
    setQueries((current) => ({ ...current, [type]: params }))
    setExportSuccess('')

    try {
      const request = type === 'crime-statistics'
        ? getCrimeStatistics(params, { signal: controller.signal })
        : type === 'monthly'
          ? getMonthlyReport(params, { signal: controller.signal })
          : getOfficerPerformance(params, { signal: controller.signal })
      const response = await request
      if (!response.data?.success || !response.data.data) throw new Error('The report response was not in the expected format.')
      setReportData((current) => ({ ...current, [type]: response.data.data }))
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = await getErrorMessage(error, 'Could not load this report.')
        setReportErrors((current) => ({ ...current, [type]: message }))
      }
    } finally {
      if (!controller.signal.aborted) {
        busyRef.current = false
        setLoadingReport('')
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadReport('crime-statistics', {}) }, 0)
    return () => {
      window.clearTimeout(timer)
      requestController.current?.abort()
      exportController.current?.abort()
      subordinateController.current?.abort()
    }
  }, [loadReport])

  const loadSubordinates = useCallback(async () => {
    if (!isSeniorOfficer(user) || subordinateRequestRef.current) return
    subordinateRequestRef.current = true
    const controller = new AbortController()
    subordinateController.current = controller
    setLoadingSubordinates(true)
    setSubordinatesError('')
    try {
      const response = await getSubordinateOfficers({}, { signal: controller.signal })
      setSubordinates(response.data.data || [])
    } catch (error) {
      if (!controller.signal.aborted) setSubordinatesError(await getErrorMessage(error, 'Could not load subordinate officers.'))
    } finally {
      if (!controller.signal.aborted) {
        subordinateRequestRef.current = false
        setLoadingSubordinates(false)
      }
    }
  }, [user])

  const selectReport = (type) => {
    if (type === activeReport || busyRef.current) return
    setExportSuccess('')
    setActiveReport(type)
    if (type === 'officer-performance' && isSeniorOfficer(user) && subordinates === null && !subordinateRequestRef.current) {
      void loadSubordinates()
    }
    if (reportData[type] == null) void loadReport(type, queries[type])
  }

  const makeQuery = (type) => {
    if (type === 'crime-statistics') {
      return Object.fromEntries(
        Object.entries({
          fromDate: draft.fromDate.trim(),
          toDate: draft.toDate.trim(),
          crimeType: draft.crimeType,
          status: draft.status,
          city: draft.city.trim(),
          state: draft.state.trim(),
          pincode: draft.pincode.trim(),
        }).filter(([, value]) => value !== ''),
      )
    }
    if (type === 'monthly') return { month: draft.month }
    return draft.officerId ? { officerId: draft.officerId } : {}
  }

  const applyFilters = (event) => {
    event.preventDefault()
    void loadReport(activeReport, makeQuery(activeReport))
  }

  const resetFilters = () => {
    const nextDraft = {
      fromDate: '',
      toDate: '',
      crimeType: '',
      status: '',
      city: '',
      state: '',
      pincode: '',
      month: currentMonth(),
      officerId: '',
    }
    setDraft(nextDraft)
    const nextQuery = activeReport === 'monthly' ? { month: nextDraft.month } : {}
    void loadReport(activeReport, nextQuery)
  }

  const handleExport = async (format) => {
    if (busyRef.current || exportBusyRef.current) return
    exportBusyRef.current = true
    const controller = new AbortController()
    exportController.current = controller
    setExporting(format)
    setExportSuccess('')
    setReportErrors((current) => ({ ...current, [activeReport]: '' }))
    try {
      const response = await exportReport(format, activeReport, queries[activeReport], { signal: controller.signal })
      const blob = new Blob([response.data], { type: response.headers['content-type'] })
      const disposition = response.headers['content-disposition'] || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `crms-report.${format === 'pdf' ? 'pdf' : 'xlsx'}`
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000)
      setExportSuccess(`${format.toUpperCase()} report downloaded.`)
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = await getErrorMessage(error, `Could not generate the ${format.toUpperCase()} export.`)
        setReportErrors((current) => ({
          ...current,
          [activeReport]: message,
        }))
      }
    } finally {
      if (!controller.signal.aborted) {
        exportBusyRef.current = false
        setExporting('')
      }
    }
  }

  const reportReady = Boolean(reportData[activeReport])
  const busy = Boolean(loadingReport || exporting)

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="container d-flex align-items-center justify-content-between gap-3 py-3">
          <div className="d-flex align-items-center gap-3">
            <div className="brand-mark brand-mark-small" aria-hidden="true">CR</div>
            <div><p className="header-kicker mb-0">CRMS</p><h1 className="header-title mb-0">Reports</h1></div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-light" onClick={() => navigate('/dashboard')} type="button">Dashboard</button>
            <button className="btn btn-outline-light" onClick={() => { logout(); navigate('/login', { replace: true }) }} type="button">Log out</button>
          </div>
        </div>
      </header>

      <main className="container py-4 py-md-5">
        <div className="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-4">
          <div><p className="eyebrow mb-1">Operational reporting</p><h2 className="section-title mb-0">Reports and exports</h2></div>
          <button className="btn btn-outline-primary" disabled={busy} onClick={() => void loadReport(activeReport, queries[activeReport])} type="button">Refresh report</button>
        </div>

        <div className="report-tabs mb-4" role="tablist" aria-label="Report types">
          {reportTabs.map(({ id, label }) => (
            <button
              aria-selected={activeReport === id}
              className={`btn ${activeReport === id ? 'btn-primary' : 'btn-outline-primary'}`}
              disabled={busy}
              id={`tab-${id}`}
              key={id}
              onClick={() => selectReport(id)}
              role="tab"
              type="button"
            >{label}</button>
          ))}
        </div>

        <section aria-labelledby={`tab-${activeReport}`} className="report-control-panel mb-4" role="tabpanel">
          <form onSubmit={applyFilters}>
            {activeReport === 'crime-statistics' && (
              <div className="row g-3 align-items-end">
                <div className="col-12 col-sm-6 col-lg-3"><label className="form-label" htmlFor="report-from-date">From date</label><input className="form-control" id="report-from-date" onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value }))} type="date" value={draft.fromDate} /></div>
                <div className="col-12 col-sm-6 col-lg-3"><label className="form-label" htmlFor="report-to-date">To date</label><input className="form-control" id="report-to-date" onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value }))} type="date" value={draft.toDate} /></div>
                <div className="col-12 col-sm-6 col-lg-3"><label className="form-label" htmlFor="report-crime-type">Crime type</label><select className="form-select" id="report-crime-type" onChange={(event) => setDraft((current) => ({ ...current, crimeType: event.target.value }))} value={draft.crimeType}><option value="">All crime types</option>{crimeTypes.map((crimeType) => <option key={crimeType} value={crimeType}>{crimeType}</option>)}</select></div>
                <div className="col-12 col-sm-6 col-lg-3"><label className="form-label" htmlFor="report-fir-status">FIR status</label><select className="form-select" id="report-fir-status" onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} value={draft.status}><option value="">All statuses</option>{firStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
                <div className="col-12 col-sm-6 col-lg-4"><label className="form-label" htmlFor="report-city">City</label><input className="form-control" id="report-city" onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} value={draft.city} /></div>
                <div className="col-12 col-sm-6 col-lg-4"><label className="form-label" htmlFor="report-state">State</label><input className="form-control" id="report-state" onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value }))} value={draft.state} /></div>
                <div className="col-12 col-sm-6 col-lg-4"><label className="form-label" htmlFor="report-pincode">Pincode</label><input className="form-control" id="report-pincode" onChange={(event) => setDraft((current) => ({ ...current, pincode: event.target.value }))} value={draft.pincode} /></div>
              </div>
            )}
            {activeReport === 'monthly' && (
              <div className="row g-3 align-items-end">
                <div className="col-12 col-sm-6 col-lg-4"><label className="form-label" htmlFor="report-month">Report month</label><input className="form-control" id="report-month" onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value }))} required type="month" value={draft.month} /></div>
              </div>
            )}
            {activeReport === 'officer-performance' && (
              <div className="row g-3 align-items-end">
                <div className="col-12 col-lg-6">
                  <label className="form-label" htmlFor="report-officer">Officer</label>
                  {isSeniorOfficer(user)
                    ? (
                      <>
                        <select className="form-select" id="report-officer" onChange={(event) => setDraft((current) => ({ ...current, officerId: event.target.value }))} value={draft.officerId}>
                          <option value="">My performance</option>
                          {(subordinates || []).map((officer) => <option key={officer._id} value={officer._id}>{officer.name} · {officer.rank} · {officer.officerId}</option>)}
                        </select>
                        {loadingSubordinates && <small className="form-text">Loading subordinate officers...</small>}
                        {subordinatesError && <div className="form-text text-danger" role="alert">{subordinatesError} <button className="btn btn-link btn-sm p-0" onClick={() => void loadSubordinates()} type="button">Retry</button></div>}
                      </>
                    )
                    : <input className="form-control" id="report-officer" readOnly value={user?.name || user?.username || 'My performance'} />}
                </div>
              </div>
            )}
            <div className="d-flex flex-wrap gap-2 mt-3">
              <button className="btn btn-primary" disabled={busy} type="submit">{loadingReport === activeReport ? 'Loading report...' : 'Apply filters'}</button>
              <button className="btn btn-outline-secondary" disabled={busy} onClick={resetFilters} type="button">Reset filters</button>
            </div>
          </form>
        </section>

        {loadingReport === activeReport && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Loading report from CRMS...</p></div>}
        {reportErrors[activeReport] && !loadingReport && <div className="alert alert-danger" role="alert">{reportErrors[activeReport]}</div>}
        {exportSuccess && <div className="alert alert-success" role="status">{exportSuccess}</div>}

        {reportReady && !loadingReport && (
          <>
            {activeReport === 'crime-statistics' && (
              <>
                <div className="row g-3 g-md-4 mb-4"><ReportMetric label="Total FIRs" value={reportData[activeReport].totalFirs} /></div>
                <ReportTable title="FIRs by crime type" columns={[{ key: 'crimeType', label: 'Crime type' }, { key: 'count', label: 'FIRs' }]} rows={reportData[activeReport].crimeTypeStats.map((row) => ({ ...row, count: formatNumber(row.count) }))} />
                <ReportTable title="FIRs by status" columns={[{ key: 'status', label: 'Status' }, { key: 'count', label: 'FIRs' }]} rows={reportData[activeReport].statusStats.map((row) => ({ ...row, count: formatNumber(row.count) }))} />
                <ReportTable title="FIRs by location" columns={[{ key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'count', label: 'FIRs' }]} rows={reportData[activeReport].locationStats.map((row) => ({ ...row, count: formatNumber(row.count) }))} />
                <ReportTable title="Daily FIR counts (UTC)" columns={[{ key: 'date', label: 'Date (UTC)' }, { key: 'count', label: 'FIRs' }]} rows={reportData[activeReport].dateStats.map((row) => ({ ...row, count: formatNumber(row.count) }))} />
              </>
            )}
            {activeReport === 'monthly' && (
              <>
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><h3 className="h5 section-title mb-0">Monthly totals: {reportData[activeReport].month} (UTC)</h3><span className="text-secondary">Data is scoped by the backend to your account where applicable.</span></div>
                <div className="row g-3 g-md-4 mb-4">
                  <ReportMetric label="FIRs" value={reportData[activeReport].statistics.firs} />
                  <ReportMetric label="Cases" value={reportData[activeReport].statistics.cases} />
                  <ReportMetric label="Evidence records" value={reportData[activeReport].statistics.evidence} />
                  <ReportMetric label="Reports" value={reportData[activeReport].statistics.reports} />
                </div>
                {Object.values(reportData[activeReport].statistics).every((value) => value === 0) && <div className="alert alert-info" role="status">No records were found for this month.</div>}
              </>
            )}
            {activeReport === 'officer-performance' && (
              <>
                <section className="report-control-panel mb-4">
                  <p className="eyebrow mb-1">Officer</p>
                  <h3 className="h5 section-title mb-1">{reportData[activeReport].officer.name}</h3>
                  <p className="text-secondary mb-0">{reportData[activeReport].officer.officerId} · {reportData[activeReport].officer.rank} · {reportData[activeReport].officer.department} · {reportData[activeReport].officer.station}</p>
                </section>
                <div className="row g-3 g-md-4 mb-4">
                  <ReportMetric label="FIRs registered" value={reportData[activeReport].metrics.firsRegistered} />
                  <ReportMetric label="Currently assigned cases" value={reportData[activeReport].metrics.currentlyAssignedCases} />
                  <ReportMetric label="Distinct cases closed" value={reportData[activeReport].metrics.distinctCasesClosedByOfficer} />
                  <ReportMetric label="Evidence for assigned cases" value={reportData[activeReport].metrics.evidenceForAssignedCases} />
                  <ReportMetric label="Reports prepared" value={reportData[activeReport].metrics.reportsPrepared} />
                </div>
                {Object.values(reportData[activeReport].metrics).every((value) => value === 0) && <div className="alert alert-info" role="status">No performance activity was recorded for this officer.</div>}
                <ReportTable title="Performance metrics" columns={[{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }]} rows={[
                  { metric: 'FIRs registered', value: formatNumber(reportData[activeReport].metrics.firsRegistered) },
                  { metric: 'Currently assigned cases', value: formatNumber(reportData[activeReport].metrics.currentlyAssignedCases) },
                  { metric: 'Distinct cases closed by officer', value: formatNumber(reportData[activeReport].metrics.distinctCasesClosedByOfficer) },
                  { metric: 'Evidence for assigned cases', value: formatNumber(reportData[activeReport].metrics.evidenceForAssignedCases) },
                  { metric: 'Reports prepared', value: formatNumber(reportData[activeReport].metrics.reportsPrepared) },
                ]} />
              </>
            )}
            <div className="d-flex flex-wrap gap-2 mb-4" aria-label="Export report">
              <button className="btn btn-outline-primary" disabled={busy} onClick={() => void handleExport('pdf')} type="button">{exporting === 'pdf' ? 'Generating PDF...' : 'Export PDF'}</button>
              <button className="btn btn-outline-primary" disabled={busy} onClick={() => void handleExport('excel')} type="button">{exporting === 'excel' ? 'Generating Excel...' : 'Export Excel'}</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default Reports
