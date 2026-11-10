import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardSidebar from '../components/DashboardSidebar'
import {
  createPoliceStation,
  getPoliceStations,
  updatePoliceStation,
  updatePoliceStationStatus,
} from '../services/api'
import { policeStationListError, policeStationRequestDiagnostics, reconcilePoliceStations, stationDirectoryState, stationSavedRefreshWarning, upsertPoliceStation } from '../utils/policeStations'

const emptyForm = { name: '', code: '', state: '' }
const requestMessage = (error, fallback) => error.response?.data?.message || (error.response ? fallback : 'Unable to reach the CRMS server. Please try again.')

function PoliceStationManagement() {
  const navigate = useNavigate()
  const [stations, setStations] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadStations = useCallback(async ({ savedStation } = {}) => {
    try {
      setLoading(true)
      setError('')
      const response = await getPoliceStations()
      if (!response.data?.success || !Array.isArray(response.data?.data)) {
        throw new Error('The police station directory response was invalid.')
      }
      setStations(reconcilePoliceStations(response.data.data, savedStation))
      return true
    } catch (requestError) {
      console.error('Police station directory request failed', policeStationRequestDiagnostics(requestError))
      if (savedStation) {
        setStations((current) => upsertPoliceStation(current, savedStation))
        setError(stationSavedRefreshWarning(requestError))
      } else {
        setError(policeStationListError(requestError))
      }
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(loadStations, 0)
    return () => window.clearTimeout(timer)
  }, [loadStations])

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      state: form.state.trim(),
    }
    if (!payload.name || !payload.code) {
      setError('Station name and code are required.')
      return
    }
    try {
      setSaving(true)
      const response = editingId
        ? await updatePoliceStation(editingId, payload)
        : await createPoliceStation(payload)
      const savedStation = response.data?.data
      if (savedStation?._id) {
        setStations((current) => upsertPoliceStation(current, savedStation))
      }
      setNotice(response.data?.message || (editingId ? 'Police station updated.' : 'Police station created.'))
      resetForm()
      await loadStations({ savedStation })
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to save the police station.'))
    } finally {
      setSaving(false)
    }
  }

  const beginEdit = (station) => {
    setForm({ name: station.name || '', code: station.code || '', state: station.state || '' })
    setEditingId(station._id)
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleStationStatus = async (station) => {
    const nextActive = !station.isActive
    const prompt = nextActive
      ? `Activate ${station.name}? It will appear in officer registration and legacy station correction.`
      : `Deactivate ${station.name}? It will disappear from registration and correction lists, and assigned officers will no longer be eligible for the Crime Map.`
    if (!window.confirm(prompt)) return
    try {
      setBusyId(station._id)
      setError('')
      setNotice('')
      const response = await updatePoliceStationStatus(station._id, nextActive)
      const savedStation = response.data?.data
      if (savedStation?._id) {
        setStations((current) => upsertPoliceStation(current, savedStation))
      }
      setNotice(response.data?.message || `Police station ${nextActive ? 'activated' : 'deactivated'}.`)
      await loadStations({ savedStation })
    } catch (requestError) {
      setError(requestMessage(requestError, 'Unable to update police station status.'))
    } finally {
      setBusyId('')
    }
  }

  const visibleStations = stations.filter((station) =>
    statusFilter === 'all' || station.isActive === (statusFilter === 'active'),
  )
  const directoryState = stationDirectoryState(visibleStations, error)

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="Police Station Management" />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="container-fluid d-flex align-items-center justify-content-between gap-3 py-3">
            <div><p className="header-kicker mb-0">CRMS / SYSTEM CONFIGURATION</p><h1 className="header-title mb-0">Police Station Management</h1></div>
            <button className="btn btn-outline-light" onClick={() => navigate('/admin/dashboard')} type="button">Dashboard</button>
          </div>
        </header>

        <main className="container-fluid py-4 py-md-5">
          <section className="welcome-card mb-4">
            <div><p className="eyebrow mb-1">Station directory</p><h2 className="section-title mb-1">Manage police stations</h2><p className="mb-0 text-secondary">Active stations are available during officer registration and legacy assignment correction.</p></div>
            <div className="account-badge"><span>Active stations</span><strong>{stations.filter((station) => station.isActive).length}</strong></div>
          </section>

          {notice && <div className="alert alert-success" role="status">{notice}</div>}
          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <section className="officer-form-card mb-4" aria-labelledby="station-form-title">
            <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
              <div><p className="eyebrow mb-1">{editingId ? 'Update directory entry' : 'Add to directory'}</p><h3 className="section-title mb-0" id="station-form-title">{editingId ? 'Edit police station' : 'Create police station'}</h3></div>
              {editingId && <button className="btn btn-outline-secondary" onClick={resetForm} type="button">Cancel edit</button>}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="row g-3 align-items-end">
                <div className="col-12 col-md-5"><label className="form-label" htmlFor="station-name">Station name</label><input autoComplete="organization" className="form-control" id="station-name" maxLength="120" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required value={form.name} /></div>
                <div className="col-12 col-md-3"><label className="form-label" htmlFor="station-code">Station code</label><input className="form-control" id="station-code" maxLength="24" onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" required title="Use letters and numbers, with optional hyphens between groups." value={form.code} /></div>
                <div className="col-12 col-md-4"><label className="form-label" htmlFor="station-state">State / region <span className="text-secondary fw-normal">(optional)</span></label><input className="form-control" id="station-state" maxLength="120" onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} value={form.state} /></div>
                <div className="col-12 d-flex flex-wrap align-items-center gap-2"><button className="btn btn-primary" disabled={saving} type="submit">{saving ? 'Saving...' : editingId ? 'Save changes' : 'Create active station'}</button>{!editingId && <span className="form-text">New stations are created active.</span>}</div>
              </div>
            </form>
          </section>

          <section aria-labelledby="station-list-title">
            <div className="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
              <div><p className="eyebrow mb-1">Directory</p><h2 className="section-title mb-0" id="station-list-title">Police stations</h2></div>
              <div className="d-flex align-items-center gap-2"><label className="form-label mb-0" htmlFor="station-status-filter">Status</label><select className="form-select" id="station-status-filter" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select><button className="btn btn-outline-primary" disabled={loading} onClick={loadStations} type="button">Refresh</button></div>
            </div>
            {loading ? <div className="dashboard-state" role="status"><div className="spinner-border text-primary" /><p className="mb-0">Loading police stations...</p></div> : directoryState === 'unavailable' ? <div className="dashboard-state empty-state-box" role="status"><p className="mb-0">The police station directory could not be verified. Use Refresh to try again.</p></div> : directoryState === 'empty' ? <div className="dashboard-state empty-state-box" role="status"><p className="mb-0">{stations.length ? 'No stations match this status filter.' : 'No police stations have been created yet.'}</p></div> : (
              <div className="officer-table-card table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Station</th><th>Code</th><th>State / region</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleStations.map((station) => <tr key={station._id}><td className="fw-semibold">{station.name}</td><td>{station.code}</td><td>{station.state || '—'}</td><td><span className={`status-badge ${station.isActive ? 'status-active' : 'status-inactive'}`}>{station.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="action-stack"><button className="btn btn-sm btn-outline-primary" onClick={() => beginEdit(station)} type="button">Edit</button><button className={`btn btn-sm ${station.isActive ? 'btn-outline-danger' : 'btn-outline-success'}`} disabled={busyId === station._id} onClick={() => toggleStationStatus(station)} type="button">{busyId === station._id ? 'Saving...' : station.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

export default PoliceStationManagement
