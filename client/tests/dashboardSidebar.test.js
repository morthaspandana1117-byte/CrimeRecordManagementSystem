import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Advanced Search remains in the operational menu and is absent from the Admin menu', async () => {
  const [sidebar, app] = await Promise.all([
    readFile(new URL('../src/components/DashboardSidebar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  ])
  const operationalItems = sidebar.match(/const officerItems = \[([\s\S]*?)\n\]/)?.[1]
  const adminItems = sidebar.match(/const adminItems = \[([\s\S]*?)\n\]/)?.[1]

  assert.ok(operationalItems)
  assert.ok(adminItems)
  assert.match(operationalItems, /to: '\/search', label: 'Advanced Search'/)
  assert.doesNotMatch(adminItems, /Advanced Search|to: '\/search'/)
  assert.match(sidebar, /const items = isAdmin\s*\? adminItems/)
  assert.match(app, /path="\/search" element=\{<ProtectedRoute allowedRanks=\{officerRanks\}><AdvancedSearch \/><\/ProtectedRoute>\}/)
})
