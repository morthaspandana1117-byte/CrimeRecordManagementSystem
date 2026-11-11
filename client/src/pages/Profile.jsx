import { useEffect, useState } from 'react'
import DashboardSidebar from '../components/DashboardSidebar'
import { getCurrentUser } from '../services/api'
import { buildProfileFields } from '../utils/profile'

function Profile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true
    getCurrentUser()
      .then((response) => {
        if (!isMounted) return
        const currentProfile = response.data?.data
        if (!currentProfile) {
          setError('Profile information is unavailable.')
          return
        }
        setProfile(currentProfile)
      })
      .catch((requestError) => {
        if (isMounted) setError(requestError.response?.data?.message || 'Unable to load profile information.')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => { isMounted = false }
  }, [])

  return (
    <div className="dashboard-page dashboard-shell">
      <DashboardSidebar title="Profile" />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="container-fluid py-3">
            <p className="header-kicker mb-0">CRMS / ACCOUNT</p>
            <h1 className="header-title mb-0">Profile</h1>
          </div>
        </header>
        <main className="container-fluid py-4 py-md-5">
          <section className="welcome-card mb-4">
            <div>
              <p className="eyebrow mb-1">Account profile</p>
              <h2 className="mb-1">Your information</h2>
              <p className="mb-0 text-secondary">Profile details for the currently signed-in account.</p>
            </div>
          </section>

          {loading && <div className="dashboard-state" role="status"><div className="spinner-border text-primary" aria-hidden="true" /><p className="mb-0">Loading profile...</p></div>}
          {!loading && error && <div className="alert alert-danger" role="alert">{error}</div>}
          {!loading && profile && <section className="officer-detail-card">
            <div className="detail-section-header"><h3>Profile information</h3></div>
            <div className="row g-3">
              {buildProfileFields(profile).map(([label, value]) => (
                <div className="col-12 col-md-6 col-xl-4" key={label}>
                  <div className="detail-value-block">
                    <span className="detail-label">{label}</span>
                    <strong>{value}</strong>
                  </div>
                </div>
              ))}
            </div>
          </section>}
        </main>
      </div>
    </div>
  )
}

export default Profile
