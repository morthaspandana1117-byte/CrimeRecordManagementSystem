const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCriminalStatus,
  validateCriminalStatus,
  buildCriminalQueryFilters,
  validateCriminal,
} = require('../controllers/criminalController');

test('normalizeCriminalStatus accepts supported values', () => {
  assert.equal(normalizeCriminalStatus('active'), 'active');
  assert.equal(normalizeCriminalStatus('ACTIVE'), 'active');
  assert.equal(normalizeCriminalStatus('wanted'), 'wanted');
  assert.equal(normalizeCriminalStatus('unknown'), null);
});

test('validateCriminalStatus rejects invalid statuses', () => {
  assert.equal(validateCriminalStatus('active'), true);
  assert.equal(validateCriminalStatus('inactive'), true);
  assert.equal(validateCriminalStatus('released'), true);
  assert.equal(validateCriminalStatus('pending'), false);
});

test('buildCriminalQueryFilters combines search and status filters', () => {
  const query = buildCriminalQueryFilters({
    search: 'Ravi',
    status: 'active',
  });

  assert.equal(query.valid, true);
  assert.equal(query.filter.status, 'active');
  assert.equal(query.filter.$or.length, 2);
  assert.equal(query.filter.$or[0].criminalId.$options, 'i');
  assert.equal(query.filter.$or[1].fullName.$options, 'i');
});

test('validateCriminal rejects missing required values', () => {
  const result = validateCriminal({
    criminalId: 'CR-1001',
    fullName: 'Ravi Kumar',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    address: 'Lucknow',
    status: 'active',
  });

  assert.equal(result, null);

  const missingStatus = validateCriminal({
    criminalId: 'CR-1001',
    fullName: 'Ravi Kumar',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    address: 'Lucknow',
    status: '',
  });

  assert.equal(missingStatus, 'All required criminal fields must be provided');
});
