import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildProfileFields } from '../src/utils/profile.js'

const clientRoot = new URL('../src/', import.meta.url)
const readSource = (path) => readFile(new URL(path, clientRoot), 'utf8')

test('builds a concise system-admin profile without officer-only fields', () => {
  const fields = buildProfileFields({
    systemRole: 'system_admin',
    username: 'admin',
    email: 'admin@example.test',
    status: 'approved',
    isActive: true,
    officerId: 'should-not-display',
  })

  assert.deepEqual(fields.map(([label]) => label), [
    'Username', 'Email address', 'Role', 'Account approval', 'Account status',
  ])
  assert.equal(fields.find(([label]) => label === 'Role')[1], 'System Admin')
  assert.ok(fields.every(([, value]) => value !== 'should-not-display'))
})

test('includes role-specific police profile fields and omits unavailable values', () => {
  const fields = buildProfileFields({
    systemRole: 'officer',
    username: 'officer',
    email: 'officer@example.test',
    status: 'approved',
    isActive: true,
    name: 'Officer Name',
    officerId: 'POL-42',
    badgeNumber: 'B-42',
    phoneNumber: '5551234',
    rank: 'si',
    department: 'criminal_investigation',
    assignedStation: 'Central Station',
    employmentStatus: 'active',
    joiningDate: '2020-01-02T00:00:00.000Z',
    passwordHash: 'never rendered',
  })
  const values = Object.fromEntries(fields)

  assert.equal(values['Full name'], 'Officer Name')
  assert.equal(values['Police ID'], 'POL-42')
  assert.equal(values['Badge number'], 'B-42')
  assert.equal(values['Police rank'], 'SI')
  assert.equal(values.Department, 'Criminal Investigation')
  assert.equal(values['Assigned police station'], 'Central Station')
  assert.ok(values['Joining date'])
  assert.equal(values.passwordHash, undefined)
  assert.equal(buildProfileFields({ systemRole: 'officer' }).length, 1)
})

test('profile route remains protected and sidebar link is shared and pinned in its footer', async () => {
  const app = await readSource('App.jsx')
  const sidebar = await readSource('components/DashboardSidebar.jsx')
  const profile = await readSource('pages/Profile.jsx')

  assert.match(app, /path="\/profile"\s+element={<ProtectedRoute allowedSystemRoles=\{\['system_admin', 'officer'\]\}><Profile \/><\/ProtectedRoute>} \/>/)
  const footer = sidebar.slice(sidebar.indexOf('<div className="sidebar-footer">'), sidebar.indexOf('</div>', sidebar.indexOf('<div className="sidebar-footer">')))
  assert.ok(footer.includes('to="/profile"'))
  assert.ok(footer.includes('<span>Profile</span>'))
  assert.ok(footer.indexOf('to="/profile"') > footer.indexOf('className="sidebar-logout"'))
  assert.match(sidebar, /onClick=\{\(\) => setOpen\(false\)\} to="\/profile"/)
  assert.match(profile, /getCurrentUser\(\)/)
  assert.match(profile, /officer-detail-card/)
  assert.match(profile, /col-12 col-md-6 col-xl-4/)
  assert.doesNotMatch(profile, /<form|<input|Save Profile|Edit Profile|Update Profile/)
})
