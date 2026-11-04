export const buildSearchParams = (state) => {
  const { category, keyword, status, priority, type, crimeType, rank, station, verificationStatus, dateFrom, dateTo, dateField, sortBy, sortDirection, page = 1 } = state
  const activeCategory = category === 'all' ? null : category
  const params = {
    category,
    page,
    limit: 20,
    sortDirection,
  }
  if (keyword.trim()) params.keyword = keyword.trim()
  if (status) params.status = status
  if (priority && activeCategory === 'cases') params.priority = priority
  if (type && activeCategory === 'evidence') params.type = type
  if (crimeType && activeCategory === 'firs') params.crimeType = crimeType
  if (rank && activeCategory === 'officers') params.rank = rank
  if (station && ['firs', 'officers'].includes(activeCategory)) params[activeCategory === 'firs' ? 'policeStation' : 'station'] = station.trim()
  if (verificationStatus && activeCategory === 'evidence') params.verificationStatus = verificationStatus
  if (dateFrom && activeCategory === 'firs') params.dateFrom = dateFrom
  if (dateTo && activeCategory === 'firs') params.dateTo = dateTo
  if (dateFrom && activeCategory === 'cases') params[dateField === 'updated' ? 'updatedFrom' : 'createdFrom'] = dateFrom
  if (dateTo && activeCategory === 'cases') params[dateField === 'updated' ? 'updatedTo' : 'createdTo'] = dateTo
  if (dateFrom && activeCategory === 'evidence') params.uploadedFrom = dateFrom
  if (dateTo && activeCategory === 'evidence') params.uploadedTo = dateTo
  if (sortBy && activeCategory) params.sortBy = sortBy
  return params
}

export const recordRoute = (record) => ({
  cases: `/cases/${record._id}`,
  firs: `/firs/${record._id}`,
  criminals: `/criminals/${record._id}`,
  officers: `/officers/${record._id}`,
  evidence: `/cases/${record.caseId?._id || record.caseId}`,
}[record.category])

export const recordTitle = (record) => record.caseNo || record.firNo || record.criminalId || record.officerId || record.evidenceId || 'Record'
export const recordSubtitle = (record) => record.title || record.fullName || record.name || record.type || record.policeStation || '—'
