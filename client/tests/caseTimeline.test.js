import assert from 'node:assert/strict'
import test from 'node:test'
import { timelineEventActor, timelineEventTitle, timelineItemsFromResponse, timelinePaginationFromResponse } from '../src/utils/caseTimeline.js'

test('parses timeline events and pagination from the API envelope', () => {
  const response = { data: { data: [{ action: 'CASE_CREATED', title: 'Case created' }], pagination: { page: 2, limit: 10, totalRecords: 21, totalPages: 3 } } }
  assert.equal(timelineItemsFromResponse(response).length, 1)
  assert.deepEqual(timelinePaginationFromResponse(response), { page: 2, limit: 10, totalRecords: 21, totalPages: 3 })
  assert.equal(timelineEventTitle(response.data.data[0]), 'Case created')
  assert.equal(timelineEventActor({}), 'Unknown actor')
})

test('handles empty and unavailable timeline responses', () => {
  assert.deepEqual(timelineItemsFromResponse({}), [])
  assert.deepEqual(timelinePaginationFromResponse({}), { page: 1, limit: 20, totalRecords: 0, totalPages: 1 })
  assert.equal(timelineEventTitle({}), 'Case event')
})
