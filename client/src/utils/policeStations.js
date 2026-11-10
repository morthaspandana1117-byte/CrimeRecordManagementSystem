export const upsertPoliceStation = (stations, savedStation) => {
  if (!savedStation?._id) return stations
  return [...stations.filter((station) => station._id !== savedStation._id), savedStation]
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const policeStationListError = (error) => {
  if (error.response) {
    const message = error.response.data?.message || 'Could not load police stations.'
    return `${message} (HTTP ${error.response.status}).`
  }
  if (error.request) return 'Unable to reach the CRMS server to load police stations.'
  return error.message || 'Could not load police stations.'
}

export const policeStationRequestDiagnostics = (error) => {
  const baseURL = error.config?.baseURL || ''
  const requestPath = error.config?.url || '/police-stations'
  const url = baseURL
    ? `${baseURL.replace(/\/$/, '')}/${requestPath.replace(/^\//, '')}`
    : requestPath
  return {
    method: (error.config?.method || 'get').toUpperCase(),
    url,
    status: error.response?.status ?? null,
    response: error.response?.data ?? null,
    message: error.message,
  }
}

export const reconcilePoliceStations = (serverStations, savedStation) =>
  savedStation ? upsertPoliceStation(serverStations, savedStation) : serverStations

export const stationDirectoryState = (stations, error) => {
  if (stations.length) return 'populated'
  return error ? 'unavailable' : 'empty'
}

export const stationSavedRefreshWarning = (error) => {
  const cause = policeStationListError(error)
  return `The station was saved successfully, but the directory could not be refreshed (${cause}). The saved station is shown here; use Refresh to retry.`
}
