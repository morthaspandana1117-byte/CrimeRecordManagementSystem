import assert from 'node:assert/strict'
import test from 'node:test'
import {
  policeStationListError,
  policeStationRequestDiagnostics,
  reconcilePoliceStations,
  stationDirectoryState,
  stationSavedRefreshWarning,
  upsertPoliceStation,
} from '../src/utils/policeStations.js'

test('successful station creation is immediately represented in the directory and active count', () => {
  const savedStation = { _id: 'station-2', name: 'North Station', isActive: true }
  const current = [{ _id: 'station-1', name: 'Central Station', isActive: true }]
  const next = upsertPoliceStation(current, savedStation)

  assert.deepEqual(next.map(({ _id }) => _id), ['station-1', 'station-2'])
  assert.equal(next.filter(({ isActive }) => isActive).length, 2)
})

test('a successful create response is retained if a directory refresh fails or is stale', () => {
  const created = { _id: 'station-2', name: 'North Station', isActive: true }
  const error = { request: {}, message: 'Network Error' }

  assert.deepEqual(reconcilePoliceStations([], created), [created])
  assert.match(stationSavedRefreshWarning(error), /saved successfully/)
  assert.match(stationSavedRefreshWarning(error), /shown here/)
})

test('a healthy refreshed directory keeps the saved response if a replica read is stale', () => {
  const created = { _id: 'station-2', name: 'North Station', isActive: true }
  const staleDirectory = [{ _id: 'station-1', name: 'Central Station', isActive: true }]

  assert.deepEqual(reconcilePoliceStations(staleDirectory, created), [
    staleDirectory[0],
    created,
  ])
})

test('directory errors explain server failures, network failures, and invalid responses accurately', () => {
  assert.equal(policeStationListError({ response: { status: 401, data: { message: 'Authentication token is required' } } }), 'Authentication token is required (HTTP 401).')
  assert.equal(policeStationListError({ request: {} }), 'Unable to reach the CRMS server to load police stations.')
  assert.equal(policeStationListError(new Error('The police station directory response was invalid.')), 'The police station directory response was invalid.')
  assert.deepEqual(policeStationRequestDiagnostics({
    config: { baseURL: 'http://localhost:5000/api', url: '/police-stations', method: 'get' },
    response: { status: 401, data: { error: 'TOKEN_REQUIRED' } },
    message: 'Request failed',
  }), {
    method: 'GET',
    url: 'http://localhost:5000/api/police-stations',
    status: 401,
    response: { error: 'TOKEN_REQUIRED' },
    message: 'Request failed',
  })
})

test('an empty directory is reported only when retrieval succeeded', () => {
  assert.equal(stationDirectoryState([], ''), 'empty')
  assert.equal(stationDirectoryState([], 'Directory request failed (HTTP 500).'), 'unavailable')
  assert.equal(stationDirectoryState([{ _id: 'station-1' }], 'Directory request failed (HTTP 500).'), 'populated')
})
