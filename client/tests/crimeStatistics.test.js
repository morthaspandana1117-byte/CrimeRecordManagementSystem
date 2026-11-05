import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCrimeStatisticsQuery,
  getCaseStatisticsCharts,
  getCaseStatisticsMetrics,
} from '../src/utils/crimeStatistics.js'

test('crime statistics dashboard metrics and chart series use the API response values', () => {
  const statistics = {
    totalCases: 4,
    openCases: 3,
    closedCases: 1,
    monthlyStats: [{ month: '2026-01', count: 2 }],
    yearlyStats: [{ year: '2026', count: 4 }],
    statusStats: [{ status: 'Open', count: 3 }, { status: 'Closed', count: 1 }],
    crimeTypeStats: [{ crimeType: 'Theft', count: 2 }],
    stateStats: [{ state: 'Karnataka', count: 4 }],
    policeStationStats: [{ policeStation: 'Central Station', count: 4 }],
    locationStats: [{ city: 'Bengaluru', state: 'Karnataka', count: 3 }],
  }

  assert.deepEqual(getCaseStatisticsMetrics(statistics), [
    { label: 'Total cases', value: 4 },
    { label: 'Open cases', value: 3 },
    { label: 'Closed cases', value: 1 },
  ])
  assert.deepEqual(getCaseStatisticsCharts(statistics).map(({ rows }) => rows), [
    [{ label: '2026-01', count: 2 }],
    [{ label: '2026', count: 4 }],
    [{ label: 'Open', count: 3 }, { label: 'Closed', count: 1 }],
    [{ label: 'Theft', count: 2 }],
    [{ label: 'Karnataka', count: 4 }],
    [{ label: 'Central Station', count: 4 }],
    [{ label: 'Bengaluru, Karnataka', count: 3 }],
  ])
})

test('crime statistics dashboard handles empty API results as zero-valued series', () => {
  assert.deepEqual(getCaseStatisticsMetrics(), [
    { label: 'Total cases', value: 0 },
    { label: 'Open cases', value: 0 },
    { label: 'Closed cases', value: 0 },
  ])
  assert.ok(getCaseStatisticsCharts().every(({ rows }) => rows.length === 0))
})

test('crime statistics filters generate only the supported non-empty API parameters', () => {
  assert.deepEqual(buildCrimeStatisticsQuery({
    fromDate: ' 2026-01-01 ',
    toDate: '',
    crimeType: 'Theft',
    status: '',
    caseStatus: 'Closed',
    city: ' Bengaluru ',
    state: '',
    pincode: '',
    policeStation: ' Central Station ',
  }), {
    fromDate: '2026-01-01',
    crimeType: 'Theft',
    caseStatus: 'Closed',
    city: 'Bengaluru',
    policeStation: 'Central Station',
  })
})
