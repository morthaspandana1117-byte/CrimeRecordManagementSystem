export const buildCrimeStatisticsQuery = (draft = {}) => Object.fromEntries(
  Object.entries({
    fromDate: draft.fromDate?.trim(),
    toDate: draft.toDate?.trim(),
    crimeType: draft.crimeType,
    status: draft.status,
    caseStatus: draft.caseStatus,
    city: draft.city?.trim(),
    state: draft.state?.trim(),
    pincode: draft.pincode?.trim(),
    policeStation: draft.policeStation?.trim(),
  }).filter(([, value]) => value !== '' && value !== undefined),
)

export const getCaseStatisticsMetrics = (caseStatistics = {}) => [
  { label: 'Total cases', value: Number(caseStatistics.totalCases) || 0 },
  { label: 'Open cases', value: Number(caseStatistics.openCases) || 0 },
  { label: 'Closed cases', value: Number(caseStatistics.closedCases) || 0 },
]

export const getCaseStatisticsCharts = (caseStatistics = {}) => [
  {
    title: 'Cases by month (Case.startDate, UTC)',
    rows: (caseStatistics.monthlyStats || []).map(({ month, count }) => ({ label: month, count: Number(count) || 0 })),
  },
  {
    title: 'Cases by year (Case.startDate, UTC)',
    rows: (caseStatistics.yearlyStats || []).map(({ year, count }) => ({ label: year, count: Number(count) || 0 })),
  },
  {
    title: 'Case status distribution',
    rows: (caseStatistics.statusStats || []).map(({ status, count }) => ({ label: status, count: Number(count) || 0 })),
  },
  {
    title: 'Cases by crime type',
    rows: (caseStatistics.crimeTypeStats || []).map(({ crimeType, count }) => ({ label: crimeType, count: Number(count) || 0 })),
  },
  {
    title: 'Cases by state',
    rows: (caseStatistics.stateStats || []).map(({ state, count }) => ({ label: state, count: Number(count) || 0 })),
  },
  {
    title: 'Cases by police station',
    rows: (caseStatistics.policeStationStats || []).map(({ policeStation, count }) => ({
      label: policeStation,
      count: Number(count) || 0,
    })),
  },
  {
    title: 'Cases by city and state',
    rows: (caseStatistics.locationStats || []).map(({ city, state, count }) => ({
      label: `${city}, ${state}`,
      count: Number(count) || 0,
    })),
  },
]
