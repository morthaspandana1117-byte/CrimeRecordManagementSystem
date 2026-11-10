import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import DashboardSidebar from '../components/DashboardSidebar'
import { getFIRMapData } from '../services/api'
import { filterMappableCrimeRecords } from '../utils/geographicCoordinates'

const crimeTypes = ['Theft', 'Robbery', 'Murder', 'Assault', 'Kidnapping', 'Fraud', 'Cyber Crime', 'Drug Offense', 'Sexual Offense', 'Property Crime', 'Other']
const caseStatuses = ['Open', 'Under Investigation', 'Court Proceedings', 'Closed', 'Reopened']
const crimeMarkerIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const formatDate = (value) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

const errorMessage = (error) => error.response?.data?.message || (
  error.response ? 'Could not load crime map records.' : 'Unable to reach the CRMS server. Please try again.'
)

const buildFilters = (filters) => Object.fromEntries(
  Object.entries(filters).filter(([, value]) => value !== ''),
)

function FitMapToRecords({ records }) {
  const map = useMap()

  useEffect(() => {
    const points = records.map(({ latitude, longitude }) => [latitude, longitude])
    if (points.length > 1) map.fitBounds(points, { padding: [24, 24], maxZoom: 12 })
    else if (points.length === 1) map.setView(points[0], 12)
  }, [map, records])

  return null
}

function MarkerDetails({ record }) {
  const location = [record.location?.city, record.location?.state].filter(Boolean).join(', ')

  return (
    <Popup>
      <div className="crime-map-popup">
        <strong>FIR: {record.firNo}</strong>
        <div>Case: {record.caseNo || 'No linked case'}</div>
        <div>Crime type: {record.crimeType}</div>
        <div>Case status: {record.caseStatus || 'Not available'}</div>
        <div>FIR status: {record.status}</div>
        <div>Date reported: {formatDate(record.date)}</div>
        {location && <div>Location: {location}</div>}
        {record.policeStation && <div>Police station: {record.policeStation}</div>}
      </div>
    </Popup>
  )
}

function CrimeMap() {
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', crimeType: '', caseStatus: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestRef = useRef(null)

  const loadMap = useCallback(async (query = {}) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    setData(null)
    try {
      const response = await getFIRMapData(query, { signal: controller.signal })
      if (!response.data?.success || !response.data?.data) throw new Error('The map response was not in the expected format.')
      setData(response.data.data)
    } catch (requestError) {
      if (!controller.signal.aborted) setError(errorMessage(requestError))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timerId = window.setTimeout(() => { void loadMap() }, 0)
    return () => {
      window.clearTimeout(timerId)
      requestRef.current?.abort()
    }
  }, [loadMap])

  const records = useMemo(
    () => filterMappableCrimeRecords(Array.isArray(data?.records) ? data.records : []),
    [data],
  )
  const center = useMemo(() => {
    if (!records.length) return null
    return [
      records.reduce((sum, record) => sum + record.latitude, 0) / records.length,
      records.reduce((sum, record) => sum + record.longitude, 0) / records.length,
    ]
  }, [records])

  const submitFilters = (event) => {
    event.preventDefault()
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      setError('Start date must be on or before end date.')
      return
    }
    void loadMap(buildFilters(filters))
  }

  const resetFilters = () => {
    const cleared = { fromDate: '', toDate: '', crimeType: '', caseStatus: '' }
    setFilters(cleared)
    void loadMap()
  }

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="Crime Map" />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="container-fluid d-flex align-items-center gap-3 py-3">
            <div><p className="header-kicker mb-0">CRMS / GEOGRAPHIC VIEW</p><h1 className="header-title mb-0">Crime Map</h1></div>
          </div>
        </header>

        <main className="container-fluid py-4 py-md-5">
          <section className="report-control-panel mb-4">
            <p className="eyebrow mb-1">Map filters</p>
            <h2 className="section-title h4 mb-3">Filter accessible FIR records</h2>
            <p className="text-secondary">Markers show FIR locations for your assigned active police station, regardless of rank. Date and case-status filters apply to those station markers; opening records remains subject to existing record-access rules.</p>
            <form onSubmit={submitFilters}>
              <div className="row g-3 align-items-end">
                <div className="col-12 col-sm-6 col-xl-3">
                  <label className="form-label" htmlFor="crime-map-from-date">From date</label>
                  <input className="form-control" id="crime-map-from-date" onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))} type="date" value={filters.fromDate} />
                </div>
                <div className="col-12 col-sm-6 col-xl-3">
                  <label className="form-label" htmlFor="crime-map-to-date">To date</label>
                  <input className="form-control" id="crime-map-to-date" onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))} type="date" value={filters.toDate} />
                </div>
                <div className="col-12 col-sm-6 col-xl-3">
                  <label className="form-label" htmlFor="crime-map-type">Crime type</label>
                  <select className="form-select" id="crime-map-type" onChange={(event) => setFilters((current) => ({ ...current, crimeType: event.target.value }))} value={filters.crimeType}>
                    <option value="">All crime types</option>
                    {crimeTypes.map((crimeType) => <option key={crimeType} value={crimeType}>{crimeType}</option>)}
                  </select>
                </div>
                <div className="col-12 col-sm-6 col-xl-3">
                  <label className="form-label" htmlFor="crime-map-case-status">Case status</label>
                  <select className="form-select" id="crime-map-case-status" onChange={(event) => setFilters((current) => ({ ...current, caseStatus: event.target.value }))} value={filters.caseStatus}>
                    <option value="">All case statuses</option>
                    {caseStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2 mt-3">
                <button className="btn btn-primary" disabled={loading} type="submit">{loading ? 'Loading...' : 'Apply filters'}</button>
                <button className="btn btn-outline-secondary" disabled={loading} onClick={resetFilters} type="button">Reset filters</button>
                <button className="btn btn-outline-primary" disabled={loading} onClick={() => void loadMap(buildFilters(filters))} type="button">Refresh</button>
              </div>
            </form>
          </section>

          {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" aria-hidden="true" /><p className="mb-0">Loading authorized crime locations...</p></div>}
          {!loading && error && <div className="alert alert-danger" role="alert">{error}</div>}
          {!loading && !error && data && (
            <>
              <div className="row g-3 mb-4">
                <div className="col-12 col-sm-4"><article className="stat-card h-100"><p className="stat-label mt-0">Matching records</p><p className="stat-value">{Number(data.totalRecords || 0).toLocaleString()}</p></article></div>
                <div className="col-12 col-sm-4"><article className="stat-card h-100"><p className="stat-label mt-0">Displayed on map</p><p className="stat-value">{records.length.toLocaleString()}</p></article></div>
                <div className="col-12 col-sm-4"><article className="stat-card h-100"><p className="stat-label mt-0">Without reliable coordinates</p><p className="stat-value">{Number(data.unmappedRecords || 0).toLocaleString()}</p></article></div>
              </div>
              {records.length > 0 ? (
                <section className="report-table-card crime-map-card" aria-label="Interactive crime map">
                  <MapContainer center={center} zoom={records.length === 1 ? 12 : 5} scrollWheelZoom={false}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitMapToRecords records={records} />
                    {records.map((record) => (
                      <Marker key={record._id} icon={crimeMarkerIcon} position={[record.latitude, record.longitude]}>
                        <MarkerDetails record={record} />
                      </Marker>
                    ))}
                  </MapContainer>
                  <p className="small text-secondary p-3 mb-0">Map tiles &copy; OpenStreetMap contributors. Markers use only explicitly recorded, validated FIR coordinates.</p>
                </section>
              ) : (
                <div className="dashboard-state empty-state-box" role="status">
                  <p className="mb-1">No records can be mapped for the selected filters.</p>
                  <p className="mb-0">Records without explicitly verified coordinates remain unmapped; addresses are not geocoded.</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default CrimeMap
