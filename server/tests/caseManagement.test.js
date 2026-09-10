const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCaseStatus,
  validateCaseStatus,
  normalizeCasePriority,
  validateCasePriority,
  buildCaseQueryFilters,
  validateCase,
} = require('../controllers/caseController');

test('normalizeCaseStatus accepts supported case states', () => {
  assert.equal(normalizeCaseStatus('Open'), 'Open');
  assert.equal(normalizeCaseStatus('open'), 'Open');
  assert.equal(normalizeCaseStatus('Under Investigation'), 'Under Investigation');
  assert.equal(normalizeCaseStatus('closed'), 'Closed');
  assert.equal(normalizeCaseStatus('Pending Review'), null);
});

test('validateCaseStatus rejects unsupported states', () => {
  assert.equal(validateCaseStatus('Open'), true);
  assert.equal(validateCaseStatus('Closed'), true);
  assert.equal(validateCaseStatus('Review'), false);
});

test('normalizeCasePriority accepts supported priorities', () => {
  assert.equal(normalizeCasePriority('High'), 'High');
  assert.equal(normalizeCasePriority('high'), 'High');
  assert.equal(normalizeCasePriority('Critical'), 'Critical');
  assert.equal(normalizeCasePriority('Urgent'), null);
});

test('validateCasePriority rejects unsupported priorities', () => {
  assert.equal(validateCasePriority('Low'), true);
  assert.equal(validateCasePriority('Medium'), true);
  assert.equal(validateCasePriority('Severe'), false);
});

test('buildCaseQueryFilters combines search and filters correctly', () => {
  const query = buildCaseQueryFilters({
    search: 'robbery',
    status: 'Open',
    priority: 'High',
  });

  assert.equal(query.valid, true);
  assert.equal(query.filter.status, 'Open');
  assert.equal(query.filter.priority, 'High');
  assert.equal(query.filter.$or.length, 2);
});

test('validateCase rejects missing required values and invalid status', async () => {
  const valid = await validateCase(
    { status: 500 },
    {
      caseNo: 'CASE-1001',
      firId: '507f1f77bcf86cd799439011',
      title: 'Fraud investigation',
      description: 'Suspicious online fraud',
      startDate: '2026-09-10',
      status: 'Open',
      priority: 'High',
      assignedOfficerIds: ['507f1f77bcf86cd799439012'],
      criminalIds: ['507f1f77bcf86cd799439013'],
    },
    false,
  );

  assert.equal(valid, 'OK');

  const invalidStatus = await validateCase(
    { status: 500 },
    {
      caseNo: 'CASE-1002',
      firId: '507f1f77bcf86cd799439011',
      title: 'Fraud investigation',
      description: 'Suspicious online fraud',
      startDate: '2026-09-10',
      status: 'Unknown',
      priority: 'High',
      assignedOfficerIds: ['507f1f77bcf86cd799439012'],
      criminalIds: ['507f1f77bcf86cd799439013'],
    },
    false,
  );

  assert.equal(invalidStatus, 'status must be one of: Open, Under Investigation, Court Proceedings, Closed');
});
