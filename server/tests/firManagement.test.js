const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const FIR = require('../models/FIR');
const Officer = require('../models/Officer');
const {
  normalizeFIRStatus,
  validateFIRStatus,
  buildFIRQueryFilters,
  createFIR,
} = require('../controllers/firController');

test('normalizeFIRStatus accepts project FIR values and aliases', () => {
  assert.equal(normalizeFIRStatus('Open'), 'Open');
  assert.equal(normalizeFIRStatus('open'), 'Open');
  assert.equal(normalizeFIRStatus('Under Investigation'), 'Under Investigation');
  assert.equal(normalizeFIRStatus('closed'), 'Closed');
  assert.equal(normalizeFIRStatus('invalid'), null);
});

test('validateFIRStatus rejects unsupported status values', () => {
  assert.equal(validateFIRStatus('Open'), true);
  assert.equal(validateFIRStatus('Under Investigation'), true);
  assert.equal(validateFIRStatus('Pending Review'), false);
});

test('buildFIRQueryFilters combines search, status and crime type filters', () => {
  const query = buildFIRQueryFilters({
    search: 'theft',
    status: 'Open',
    crimeType: 'Theft',
  });

  assert.equal(query.valid, true);
  assert.equal(query.filter.status, 'Open');
  assert.equal(query.filter.crimeType, 'Theft');
  assert.equal(query.filter.$or.length, 7);
});

test('createFIR rejects ineligible registered officers without crashing', async (t) => {
  const officerId = '507f1f77bcf86cd799439011';

  mock.method(Officer, 'findById', async () => ({
    _id: officerId,
    status: 'inactive',
    userId: {
      status: 'approved',
      isActive: true,
      role: 'officer',
    },
  }));

  mock.method(FIR, 'create', async () => ({
    _id: 'fir-123',
    firNo: 'FIR-1001',
    status: 'Open',
  }));

  t.after(() => {
    mock.restoreAll();
  });

  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };

  const result = await createFIR({
    user: { role: 'admin' },
    body: {
      firNo: 'FIR-1001',
      date: '2026-09-10',
      policeStation: 'Central Police Station',
      complaint: {
        complainantName: 'Asha Verma',
        complainantPhone: '9876543210',
        complaintText: 'Laptop stolen from market',
      },
      description: 'Theft complaint from local market',
      crimeType: 'Theft',
      location: {
        address: 'Main Market Road',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        pincode: '226001',
      },
      registeredBy: officerId,
      criminalIds: ['507f1f77bcf86cd799439012'],
      status: 'Open',
    },
  }, res);

  assert.equal(res.code, 403);
  assert.equal(result.success, false);
  assert.equal(result.error, 'OFFICER_INELIGIBLE');
});
