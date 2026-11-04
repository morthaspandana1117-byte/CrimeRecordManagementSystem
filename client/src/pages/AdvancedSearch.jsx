import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import DashboardSidebar from '../components/DashboardSidebar'
import { searchRecords } from '../services/api'
import { isSeniorOfficer } from '../authority'
import { buildSearchParams, recordRoute, recordSubtitle, recordTitle } from '../utils/advancedSearch'

const categories = [
  { value: 'all', label: 'All records' },
  { value: 'cases', label: 'Cases' },
  { value: 'firs', label: 'FIRs' },
  { value: 'criminals', label: 'Criminals' },
  { value: 'officers', label: 'Officers' },
  { value: 'evidence', label: 'Evidence' },
]
const statuses = {
  cases: ['Open', 'Under Investigation', 'Court Proceedings', 'Closed', 'Reopened'],
  firs: ['Open', 'Registered', 'Under Investigation', 'Charge Sheet Filed', 'Closed'],
  criminals: ['active', 'inactive', 'wanted', 'arrested', 'released', 'deceased'],
  evidence: ['Collected', 'Under Examination', 'Verified', 'Stored', 'Released', 'Disposed'],
}
const crimeTypes = ['Theft', 'Robbery', 'Murder', 'Assault', 'Kidnapping', 'Fraud', 'Cyber Crime', 'Drug Offense', 'Sexual Offense', 'Property Crime', 'Other']
const evidenceTypes = ['Document', 'Photograph', 'Video', 'Weapon', 'Biological', 'Digital', 'Physical', 'Other']
const ranks = ['sp', 'dsp', 'inspector', 'si', 'asi', 'head_constable', 'constable']
const sortOptions = {
  cases: [['createdAt', 'Created'], ['updatedAt', 'Updated'], ['caseNo', 'Case number'], ['title', 'Title']],
  firs: [['date', 'FIR date'], ['createdAt', 'Created'], ['firNo', 'FIR number']],
  criminals: [['createdAt', 'Created'], ['fullName', 'Name'], ['criminalId', 'Criminal ID']],
  officers: [['createdAt', 'Created'], ['name', 'Name'], ['officerId', 'Officer ID'], ['rank', 'Rank']],
  evidence: [['collectionDate', 'Collection date'], ['createdAt', 'Created'], ['evidenceId', 'Evidence ID']],
}
const message = (error) => error.response?.data?.message || error.response?.data?.error || 'Unable to search records.'

function AdvancedSearch() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const canSearchOfficers = user?.role === 'admin' || user?.systemRole === 'system_admin' || isSeniorOfficer(user)
  const visibleCategories = categories.filter((item) => item.value !== 'officers' || canSearchOfficers)
  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [type, setType] = useState('')
  const [crimeType, setCrimeType] = useState('')
  const [rank, setRank] = useState('')
  const [station, setStation] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')
  const [dateField, setDateField] = useState('created')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDirection, setSortDirection] = useState('desc')
  const [page, setPage] = useState(1)
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const activeCategory = category === 'all' ? null : category
  const supportsStatus = activeCategory ? statuses[activeCategory] : null
  const params = useMemo(() => buildSearchParams({
    category, keyword, status, priority, type, crimeType, rank, station, verificationStatus,
    dateFrom, dateTo, dateField, sortBy, sortDirection, page,
  }), [category, keyword, status, priority, type, crimeType, rank, station, verificationStatus, dateFrom, dateTo, dateField, sortBy, sortDirection, page])

  const apply = async (event, requestedPage = page) => {
    event?.preventDefault()
    setLoading(true)
    setError('')
    try {
      setPage(requestedPage)
      const response = await searchRecords({ ...params, page: requestedPage })
      setGroups(response.data?.results || [])
    } catch (requestError) {
      setGroups([])
      setError(message(requestError))
    } finally {
      setLoading(false)
    }
  }

  const loadGroupPage = async (group, requestedPage) => {
    setLoading(true)
    setError('')
    try {
      const response = await searchRecords({
        ...buildSearchParams({
          category: group.category,
          keyword,
          status,
          priority,
          type,
          crimeType,
          rank,
          station,
          verificationStatus,
          dateFrom,
          dateTo,
          dateField,
          sortBy: '',
          sortDirection,
          page: requestedPage,
        }),
      })
      const updatedGroup = response.data?.results?.[0]
      if (updatedGroup) {
        setGroups((currentGroups) => currentGroups.map((currentGroup) => (
          currentGroup.category === group.category ? updatedGroup : currentGroup
        )))
      }
    } catch (requestError) {
      setError(message(requestError))
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setKeyword(''); setStatus(''); setPriority(''); setType(''); setCrimeType(''); setRank(''); setStation('')
    setVerificationStatus(''); setDateField('created'); setDateFrom(''); setDateTo(''); setSortBy(''); setSortDirection('desc')
    setPage(1); setGroups([]); setError('')
  }

  const changeCategory = (value) => {
    setCategory(value); setStatus(''); setPriority(''); setType(''); setCrimeType(''); setRank(''); setStation('')
    setVerificationStatus(''); setDateFrom(''); setDateTo(''); setSortBy(''); setPage(1)
  }

  const availableSortOptions = activeCategory ? sortOptions[activeCategory] : []
  const hasResults = groups.some((group) => group.data?.length)

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="Advanced Search" />
      <div className="dashboard-main">
        <header className="dashboard-header"><div className="container-fluid py-3"><p className="header-kicker mb-0">CRMS / DISCOVERY</p><h1 className="header-title mb-0">Advanced Search</h1></div></header>
        <main className="container-fluid py-4 py-md-5">
          <section className="fir-control-panel mb-4">
            <form onSubmit={apply}>
              <div className="row g-3 align-items-end">
                <div className="col-12 col-lg-5"><label className="form-label" htmlFor="advanced-search-keyword">Keywords</label><input className="form-control" id="advanced-search-keyword" onChange={(event) => setKeyword(event.target.value)} placeholder="Search supported record fields" value={keyword} /></div>
                <div className="col-12 col-md-4 col-lg-3"><label className="form-label" htmlFor="advanced-search-category">Category</label><select className="form-select" id="advanced-search-category" onChange={(event) => changeCategory(event.target.value)} value={category}>{visibleCategories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
                {supportsStatus && <div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-status">Status</label><select className="form-select" id="advanced-search-status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="">All statuses</option>{supportsStatus.map((value) => <option key={value}>{value}</option>)}</select></div>}
                {activeCategory === 'cases' && <><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-priority">Priority</label><select className="form-select" id="advanced-search-priority" onChange={(event) => setPriority(event.target.value)} value={priority}><option value="">All priorities</option>{['Low', 'Medium', 'High', 'Critical'].map((value) => <option key={value}>{value}</option>)}</select></div><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-date-field">Date field</label><select className="form-select" id="advanced-search-date-field" onChange={(event) => setDateField(event.target.value)} value={dateField}><option value="created">Created</option><option value="updated">Updated</option></select></div></>}
                {activeCategory === 'firs' && <><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-crime-type">Crime type</label><select className="form-select" id="advanced-search-crime-type" onChange={(event) => setCrimeType(event.target.value)} value={crimeType}><option value="">All types</option>{crimeTypes.map((value) => <option key={value}>{value}</option>)}</select></div><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-station">Police station</label><input className="form-control" id="advanced-search-station" onChange={(event) => setStation(event.target.value)} value={station} /></div></>}
                {activeCategory === 'officers' && <><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-rank">Rank</label><select className="form-select" id="advanced-search-rank" onChange={(event) => setRank(event.target.value)} value={rank}><option value="">All ranks</option>{ranks.map((value) => <option key={value}>{value}</option>)}</select></div><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-station">Police station</label><input className="form-control" id="advanced-search-station" onChange={(event) => setStation(event.target.value)} value={station} /></div></>}
                {activeCategory === 'evidence' && <><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-type">Evidence type</label><select className="form-select" id="advanced-search-type" onChange={(event) => setType(event.target.value)} value={type}><option value="">All types</option>{evidenceTypes.map((value) => <option key={value}>{value}</option>)}</select></div><div className="col-12 col-md-4 col-lg-2"><label className="form-label" htmlFor="advanced-search-verification">Verification</label><select className="form-select" id="advanced-search-verification" onChange={(event) => setVerificationStatus(event.target.value)} value={verificationStatus}><option value="">All results</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></div></>}
                {activeCategory && <><div className="col-12 col-md-6 col-lg-2"><label className="form-label" htmlFor="advanced-search-from">Date from</label><input className="form-control" id="advanced-search-from" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} /></div><div className="col-12 col-md-6 col-lg-2"><label className="form-label" htmlFor="advanced-search-to">Date to</label><input className="form-control" id="advanced-search-to" onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} /></div></>}
                {activeCategory ? <><div className="col-12 col-md-6 col-lg-2"><label className="form-label" htmlFor="advanced-search-sort">Sort field ({activeCategory})</label><select className="form-select" id="advanced-search-sort" onChange={(event) => setSortBy(event.target.value)} value={sortBy}><option value="">Default</option>{availableSortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="col-12 col-md-6 col-lg-2"><label className="form-label" htmlFor="advanced-search-direction">Direction ({activeCategory})</label><select className="form-select" id="advanced-search-direction" onChange={(event) => setSortDirection(event.target.value)} value={sortDirection}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div></> : <div className="col-12 col-md-6 col-lg-4"><p className="form-text mb-0">Date and sort filters are available after selecting a category.</p></div>}
                <div className="col-12 col-md-6 col-lg-2 d-flex gap-2"><button className="btn btn-primary flex-grow-1" disabled={loading} type="submit">{loading ? 'Searching...' : 'Apply Filters'}</button><button className="btn btn-outline-primary" onClick={clear} type="button">Clear</button></div>
              </div>
            </form>
          </section>
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {!loading && category === 'all' && groups.length > 0 && <p className="text-secondary">Results are paginated separately by category.</p>}
          {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Searching authorized records...</p></div>}
          {!loading && !hasResults && <div className="dashboard-state empty-state-box">No matching records found.</div>}
          {!loading && hasResults && groups.map((group) => (
            <section className="mb-4" key={group.category}>
              <div className="d-flex justify-content-between align-items-center mb-3"><h2 className="section-title mb-0 text-capitalize">{group.category}</h2><span className="text-secondary">{group.totalRecords} matching record{group.totalRecords === 1 ? '' : 's'} · Page {group.page} of {group.totalPages}</span></div>
              <div className="row g-3">{group.data.map((record) => <div className="col-12 col-md-6 col-xl-4" key={`${record.category}-${record._id}`}><article className="stat-card h-100"><p className="eyebrow mb-1">{record.category}</p><h3 className="h5">{recordTitle(record)}</h3><p className="mb-2">{recordSubtitle(record)}</p>{record.status && <p className="mb-3"><span className="status-badge">{record.status}</span></p>}<button className="btn btn-outline-primary" onClick={() => navigate(recordRoute(record))} type="button">Open record</button></article></div>)}</div>
              {!loading && group.totalPages > 1 && <nav aria-label={`${group.category} search result pages`} className="d-flex justify-content-center align-items-center gap-3 mt-3"><button className="btn btn-outline-primary" disabled={loading || group.page <= 1} onClick={() => category === 'all' ? loadGroupPage(group, group.page - 1) : apply(undefined, group.page - 1)} type="button">Previous</button><span>Page {group.page} of {group.totalPages}</span><button className="btn btn-outline-primary" disabled={loading || group.page >= group.totalPages} onClick={() => category === 'all' ? loadGroupPage(group, group.page + 1) : apply(undefined, group.page + 1)} type="button">Next</button></nav>}
            </section>
          ))}
        </main>
      </div>
    </div>
  )
}

export default AdvancedSearch
