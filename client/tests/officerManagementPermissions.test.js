import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientRoot = new URL('../src/', import.meta.url)
const readSource = (path) => readFile(new URL(path, clientRoot), 'utf8')

test('officer edit route is restricted to System Admin while rank managers retain detail access', async () => {
  const app = await readSource('App.jsx')
  assert.match(app, /path="\/officers" element={<ProtectedRoute allowedManagementRanks=\{seniorOfficerManagementRanks\} allowSystemAdmin><OfficerManagement \/><\/ProtectedRoute>} \/>/)
  assert.match(app, /path="\/officers\/:id" element={<ProtectedRoute allowedManagementRanks=\{seniorOfficerManagementRanks\}><OfficerDetails \/><\/ProtectedRoute>} \/>/)
  assert.match(app, /path="\/officers\/:id\/edit" element={<ProtectedRoute allowedSystemRoles=\{\['system_admin'\]\}><OfficerEdit \/><\/ProtectedRoute>} \/>/)
})

test('higher-ranking officers only receive View in the interface; admin actions remain visible to admin', async () => {
  const [management, details] = await Promise.all([
    readSource('pages/OfficerManagement.jsx'),
    readSource('pages/OfficerDetails.jsx'),
  ])

  assert.ok(management.includes('>View</button>'))
  assert.ok(management.includes('{systemAdmin && <button className="btn btn-sm btn-outline-secondary"'))
  assert.ok(management.includes('>Edit</button>'))
  assert.ok(management.includes("{systemAdmin && approvalStatus === 'approved' && <button"))
  assert.match(management, /systemAdmin && approvalStatus === 'pending'/)
  assert.ok(details.includes('{systemAdmin && <button className="btn btn-primary"'))
  assert.ok(details.includes('>Edit Officer</button>'))
  assert.match(management, /systemAdmin \? getOfficers\(buildParams\) : getSubordinateOfficers\(buildParams\)/)
})
