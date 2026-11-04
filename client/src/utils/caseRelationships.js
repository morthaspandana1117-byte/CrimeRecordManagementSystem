export const relationshipDisclaimer = 'These relationships are automatically identified from shared records or identical evidence files. They are investigative leads, not proof of criminal involvement or a confirmed connection between cases.'

export const relationshipItemsFromResponse = (response) => (
  Array.isArray(response?.data?.data) ? response.data.data : []
)

export const relationshipPaginationFromResponse = (response) => ({
  page: response?.data?.pagination?.page || 1,
  limit: response?.data?.pagination?.limit || 20,
  totalRecords: response?.data?.pagination?.totalRecords || 0,
  totalPages: response?.data?.pagination?.totalPages || 1,
})

export const relationshipReasonLabel = (reason) => reason || 'Deterministic record relationship'
