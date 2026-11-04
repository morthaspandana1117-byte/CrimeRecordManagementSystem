export const timelineItemsFromResponse = (response) => (
  Array.isArray(response?.data?.data) ? response.data.data : []
)

export const timelinePaginationFromResponse = (response) => ({
  page: response?.data?.pagination?.page || 1,
  limit: response?.data?.pagination?.limit || 20,
  totalRecords: response?.data?.pagination?.totalRecords || 0,
  totalPages: response?.data?.pagination?.totalPages || 1,
})

export const timelineEventTitle = (event) => event?.title || event?.action || 'Case event'
export const timelineEventActor = (event) => event?.actor || 'Unknown actor'
