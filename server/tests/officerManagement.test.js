const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOfficerSearchValue,
  buildOfficerFilters,
  normalizeAccountStatus,
  validateOfficerAccountStatus,
  normalizeApprovalStatus,
  validateOfficerQueryFilters,
} = require('../controllers/officerController');

test('normalizeOfficerSearchValue trims and lowercases the input', () => {
  assert.equal(normalizeOfficerSearchValue('  SPANDANA  '), 'spandana');
  assert.equal(normalizeOfficerSearchValue('   '), '');
});

test('buildOfficerFilters supports search and status filters together', () => {
  const filters = buildOfficerFilters({
    search: 'SPANDANA',
    approvalStatus: 'approved',
    accountStatus: 'active',
  });

  assert.equal(filters.search, 'spandana');
  assert.equal(filters.approvalStatus, 'approved');
  assert.equal(filters.accountStatus, 'active');
  assert.deepEqual(filters.searchRegex instanceof RegExp, true);
});

test('normalizeAccountStatus accepts only active or inactive values', () => {
  assert.equal(normalizeAccountStatus('active'), 'active');
  assert.equal(normalizeAccountStatus('inactive'), 'inactive');
  assert.equal(normalizeAccountStatus('ACTIVE'), 'active');
  assert.equal(normalizeAccountStatus('unknown'), null);
});

test('validateOfficerAccountStatus rejects invalid statuses', () => {
  assert.equal(validateOfficerAccountStatus('active'), true);
  assert.equal(validateOfficerAccountStatus('inactive'), true);
  assert.equal(validateOfficerAccountStatus('pending'), false);
  assert.equal(validateOfficerAccountStatus('approved'), false);
});

test('invalid approval and account filters are rejected', () => {
  const invalidApproval = validateOfficerQueryFilters({ approvalStatus: 'unknown' });
  const invalidAccount = validateOfficerQueryFilters({ accountStatus: 'disabled' });

  assert.equal(invalidApproval.valid, false);
  assert.equal(invalidApproval.error, 'INVALID_APPROVAL_STATUS');
  assert.equal(invalidAccount.valid, false);
  assert.equal(invalidAccount.error, 'INVALID_ACCOUNT_STATUS');
  assert.equal(normalizeApprovalStatus('pending'), 'pending');
  assert.equal(normalizeApprovalStatus('bad'), null);
});
