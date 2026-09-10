const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEvidenceStatus,
  validateEvidenceStatus,
  normalizeEvidenceType,
  validateEvidenceType,
  buildEvidenceQueryFilters,
  validateEvidence,
} = require('../controllers/evidenceController');

test('normalizeEvidenceStatus accepts supported evidence states', () => {
  assert.equal(normalizeEvidenceStatus('Collected'), 'Collected');
  assert.equal(normalizeEvidenceStatus('collected'), 'Collected');
  assert.equal(normalizeEvidenceStatus('Under Examination'), 'Under Examination');
  assert.equal(normalizeEvidenceStatus('released'), 'Released');
  assert.equal(normalizeEvidenceStatus('Pending Review'), null);
});

test('validateEvidenceStatus rejects unsupported states', () => {
  assert.equal(validateEvidenceStatus('Collected'), true);
  assert.equal(validateEvidenceStatus('Verified'), true);
  assert.equal(validateEvidenceStatus('Review'), false);
});

test('normalizeEvidenceType accepts supported evidence types', () => {
  assert.equal(normalizeEvidenceType('Document'), 'Document');
  assert.equal(normalizeEvidenceType('document'), 'Document');
  assert.equal(normalizeEvidenceType('Photograph'), 'Photograph');
  assert.equal(normalizeEvidenceType('Unknown'), null);
});

test('validateEvidenceType rejects unsupported types', () => {
  assert.equal(validateEvidenceType('Video'), true);
  assert.equal(validateEvidenceType('Weapon'), true);
  assert.equal(validateEvidenceType('Artifact'), false);
});

test('buildEvidenceQueryFilters combines search and filters correctly', () => {
  const query = buildEvidenceQueryFilters({
    search: 'wallet',
    status: 'Verified',
    type: 'Physical',
  });

  assert.equal(query.valid, true);
  assert.equal(query.filter.status, 'Verified');
  assert.equal(query.filter.type, 'Physical');
  assert.equal(query.filter.$or.length, 4);
});

test('validateEvidence rejects missing required values and invalid status', async () => {
  const valid = await validateEvidence(
    { status: 500 },
    {
      evidenceId: 'EVD-1001',
      caseId: '507f1f77bcf86cd799439011',
      type: 'Physical',
      description: 'Black leather wallet recovered from scene',
      collectedBy: '507f1f77bcf86cd799439012',
      collectionDate: '2026-09-10',
      location: 'Main Street Market',
      status: 'Collected',
    },
    false,
  );

  assert.equal(valid, 'OK');

  const invalidStatus = await validateEvidence(
    { status: 500 },
    {
      evidenceId: 'EVD-1002',
      caseId: '507f1f77bcf86cd799439011',
      type: 'Physical',
      description: 'Black leather wallet recovered from scene',
      collectedBy: '507f1f77bcf86cd799439012',
      collectionDate: '2026-09-10',
      location: 'Main Street Market',
      status: 'Pending Review',
    },
    false,
  );

  assert.equal(invalidStatus, 'status must be one of: Collected, Under Examination, Verified, Stored, Released, Disposed');
});
