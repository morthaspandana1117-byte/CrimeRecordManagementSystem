import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coordinatePayload,
  filterMappableCrimeRecords,
  isMappableCrimeRecord,
  validateOptionalCoordinates,
} from '../src/utils/geographicCoordinates.js'

test('optional coordinates require a pair and accept inclusive valid boundaries', () => {
  assert.equal(validateOptionalCoordinates('', ''), '')
  assert.equal(validateOptionalCoordinates('-90', '180'), '')
  assert.equal(validateOptionalCoordinates('90', '-180'), '')
  assert.match(validateOptionalCoordinates('1', ''), /both verified/)
  assert.match(validateOptionalCoordinates('', '1'), /both verified/)
  assert.deepEqual(coordinatePayload('', ''), { latitude: null, longitude: null })
  assert.deepEqual(coordinatePayload('12.5', '-45.25'), { latitude: 12.5, longitude: -45.25 })
})

test('optional coordinates reject non-numeric and out-of-range values', () => {
  assert.match(validateOptionalCoordinates('90.01', '0'), /Latitude/)
  assert.match(validateOptionalCoordinates('0', '-180.01'), /Longitude/)
  assert.match(validateOptionalCoordinates('north', '0'), /Latitude/)
  assert.match(validateOptionalCoordinates('0', 'east'), /Longitude/)
})

test('map records exclude missing, non-numeric, and out-of-range coordinates', () => {
  const valid = { _id: 'valid', latitude: 0, longitude: 0 }
  const edge = { _id: 'edge', latitude: -90, longitude: 180 }
  const candidates = [
    valid,
    edge,
    { _id: 'missing-latitude', longitude: 1 },
    { _id: 'missing-longitude', latitude: 1 },
    { _id: 'invalid-latitude', latitude: 91, longitude: 1 },
    { _id: 'invalid-longitude', latitude: 1, longitude: -181 },
    { _id: 'string-coordinates', latitude: '1', longitude: '2' },
    { _id: 'non-finite', latitude: Number.NaN, longitude: 2 },
  ]

  assert.equal(isMappableCrimeRecord(valid), true)
  assert.deepEqual(filterMappableCrimeRecords(candidates), [valid, edge])
})
