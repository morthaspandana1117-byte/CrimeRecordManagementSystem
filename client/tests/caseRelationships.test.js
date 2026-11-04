import assert from 'node:assert/strict'
import test from 'node:test'
import { relationshipDisclaimer, relationshipItemsFromResponse, relationshipPaginationFromResponse, relationshipReasonLabel } from '../src/utils/caseRelationships.js'

test('parses related cases and pagination from the API envelope', () => {
  const response = { data: { data: [{ caseNo: 'CASE-002', reasons: ['Shared criminal record'] }], pagination: { page: 2, limit: 1, totalRecords: 3, totalPages: 3 } } }
  assert.equal(relationshipItemsFromResponse(response).length, 1)
  assert.deepEqual(relationshipPaginationFromResponse(response), { page: 2, limit: 1, totalRecords: 3, totalPages: 3 })
  assert.equal(relationshipReasonLabel(response.data.data[0].reasons[0]), 'Shared criminal record')
})

test('handles empty responses and unavailable reason labels', () => {
  assert.deepEqual(relationshipItemsFromResponse({}), [])
  assert.deepEqual(relationshipPaginationFromResponse({}), { page: 1, limit: 20, totalRecords: 0, totalPages: 1 })
  assert.equal(relationshipReasonLabel(''), 'Deterministic record relationship')
  assert.match(relationshipDisclaimer, /investigative leads, not proof of criminal involvement/)
})
