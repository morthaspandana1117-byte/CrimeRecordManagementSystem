export const validateOptionalCoordinates = (latitude, longitude) => {
  const hasLatitude = latitude.trim() !== ''
  const hasLongitude = longitude.trim() !== ''

  if (hasLatitude !== hasLongitude) return 'Enter both verified latitude and longitude, or leave both blank.'
  if (!hasLatitude) return ''

  const latitudeValue = Number(latitude)
  const longitudeValue = Number(longitude)
  if (!Number.isFinite(latitudeValue) || latitudeValue < -90 || latitudeValue > 90) {
    return 'Latitude must be between -90 and 90.'
  }
  if (!Number.isFinite(longitudeValue) || longitudeValue < -180 || longitudeValue > 180) {
    return 'Longitude must be between -180 and 180.'
  }
  return ''
}

export const coordinatePayload = (latitude, longitude) => {
  const validationError = validateOptionalCoordinates(latitude, longitude)
  if (validationError) return { error: validationError }
  if (latitude.trim() === '') return { latitude: null, longitude: null }
  return { latitude: Number(latitude), longitude: Number(longitude) }
}

export const isMappableCrimeRecord = (record) => (
  typeof record?.latitude === 'number' &&
  Number.isFinite(record.latitude) &&
  record.latitude >= -90 &&
  record.latitude <= 90 &&
  typeof record?.longitude === 'number' &&
  Number.isFinite(record.longitude) &&
  record.longitude >= -180 &&
  record.longitude <= 180
)

export const filterMappableCrimeRecords = (records = []) => records.filter(isMappableCrimeRecord)
