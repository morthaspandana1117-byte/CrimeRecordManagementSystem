import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSearchParams, recordRoute, recordSubtitle, recordTitle } from '../src/utils/advancedSearch.js'

test('builds allowlisted category-specific search parameters', () => {
  assert.deepEqual(buildSearchParams({
    category: 'evidence',
    keyword: '  Evidence  ',
    status: 'Verified',
    priority: 'High',
    type: 'Document',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
    sortBy: 'collectionDate',
    sortDirection: 'asc',
  }), {
    category: 'evidence',
    keyword: 'Evidence',
    status: 'Verified',
    type: 'Document',
    uploadedFrom: '2026-10-01',
    uploadedTo: '2026-10-31',
    sortBy: 'collectionDate',
    sortDirection: 'asc',
    page: 1,
    limit: 20,
  })
})

test('does not apply category-specific date or sort filters to all records', () => {
  assert.deepEqual(buildSearchParams({
    category: 'all',
    keyword: 'case',
    dateFrom: '2026-02-01',
    dateTo: '2026-02-28',
    dateField: 'updated',
    sortBy: 'updatedAt',
    sortDirection: 'asc',
  }), {
    category: 'all',
    keyword: 'case',
    sortDirection: 'asc',
    page: 1,
    limit: 20,
  })
})

test('builds existing record routes and readable result labels', () => {
  const record = { category: 'cases', _id: 'case-1', caseNo: 'CASE-1', title: 'Theft case' }
  assert.equal(recordRoute(record), '/cases/case-1')
  assert.equal(recordTitle(record), 'CASE-1')
  assert.equal(recordSubtitle(record), 'Theft case')
})
