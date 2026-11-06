const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const Officer = require('../models/Officer');
const FIR = require('../models/FIR');
const Case = require('../models/Case');
const Criminal = require('../models/Criminal');
const Evidence = require('../models/Evidence');
const Report = require('../models/Report');

const userId = new mongoose.Types.ObjectId();
const officerId = new mongoose.Types.ObjectId();
const caseId = new mongoose.Types.ObjectId();

const validDocuments = [
  [User, {
    username: 'test-user', email: 'test@example.test', passwordHash: 'hash',
    role: 'officer', status: 'approved', isActive: true,
  }],
  [Officer, {
    userId, officerId: 'OFF-1', badgeNumber: 'AB1234', name: 'Test Officer',
    rank: 'constable', department: 'Traffic', station: 'Central',
    phoneNumber: '1234567890', address: 'Test address', joiningDate: new Date('2020-01-01'),
    status: 'active',
  }],
  [FIR, {
    firNo: 'FIR-1', date: new Date('2025-01-01'), policeStation: 'Central',
    complaint: { complainantName: 'Reporter', complaintText: 'Reported incident' },
    description: 'Incident description', crimeType: 'Theft',
    location: { address: '1 Main St', city: 'Test City', state: 'Test State', pincode: '123456' },
    registeredBy: officerId, criminalIds: [], status: 'Open',
  }],
  [Case, {
    caseNo: 'CASE-1', firId: caseId, assignedOfficerIds: [officerId], criminalIds: [],
    title: 'Test case', description: 'Case description', startDate: new Date('2025-01-01'),
    status: 'Open', priority: 'Medium',
  }],
  [Criminal, {
    criminalId: 'CR-1', fullName: 'Test Person', dateOfBirth: new Date('1990-01-01'),
    gender: 'Other', address: 'Test address', status: 'active',
  }],
  [Evidence, {
    evidenceId: 'EV-1', caseId, investigationRound: 1, type: 'Document',
    description: 'Test evidence', collectedBy: officerId,
    collectionDate: new Date('2025-01-01'), location: 'Central station',
    status: 'Collected', verificationStatus: 'unverified',
  }],
  [Report, {
    reportId: 'REP-1', caseId, preparedBy: officerId,
    reportType: 'Investigation Report', title: 'Test report', content: 'Report content',
    reportDate: new Date('2025-01-01'), status: 'Draft',
  }],
];

async function validationError(Model, document) {
  try {
    await new Model(document).validate();
    return undefined;
  } catch (error) {
    return error;
  }
}

test('valid representative documents pass core model schema validation', async () => {
  for (const [Model, document] of validDocuments) {
    assert.equal(await validationError(Model, document), undefined, `${Model.modelName} should be valid`);
  }
});

test('core models enforce important required fields', async () => {
  const cases = [
    [User, { email: 'test@example.test', passwordHash: 'hash' }, 'username'],
    [Officer, { officerId: 'OFF-1', badgeNumber: 'AB1234' }, 'userId'],
    [FIR, { date: new Date(), description: 'Description' }, 'firNo'],
    [Case, { firId: caseId, title: 'Title', description: 'Description' }, 'caseNo'],
    [Criminal, { fullName: 'Test Person', address: 'Address' }, 'criminalId'],
    [Evidence, { caseId, description: 'Description' }, 'evidenceId'],
    [Report, { caseId, title: 'Title', content: 'Content' }, 'reportId'],
  ];

  for (const [Model, document, field] of cases) {
    const error = await validationError(Model, document);
    assert.equal(error?.errors[field]?.kind, 'required', `${Model.modelName}.${field} should be required`);
  }
});

test('core models reject values outside their declared enums', async () => {
  const cases = [
    [User, { username: 'test', email: 'test@example.test', passwordHash: 'hash', role: 'root' }, 'role'],
    [Officer, { userId, officerId: 'OFF-1', badgeNumber: 'AB1234', name: 'Test', rank: 'chief', department: 'Traffic', station: 'Central', phoneNumber: '123', address: 'Address', joiningDate: new Date() }, 'rank'],
    [FIR, { firNo: 'FIR-1', date: new Date(), policeStation: 'Central', complaint: { complainantName: 'Reporter', complaintText: 'Text' }, description: 'Description', crimeType: 'Arson', location: { address: 'Address', city: 'City', state: 'State', pincode: '123456' }, registeredBy: officerId }, 'crimeType'],
    [Case, { caseNo: 'CASE-1', firId: caseId, title: 'Title', description: 'Description', startDate: new Date(), priority: 'Urgent' }, 'priority'],
    [Criminal, { criminalId: 'CR-1', fullName: 'Person', dateOfBirth: new Date(), gender: 'Unknown', address: 'Address', status: 'active' }, 'gender'],
    [Evidence, { evidenceId: 'EV-1', caseId, investigationRound: 1, type: 'Unknown', description: 'Description', collectedBy: officerId, collectionDate: new Date(), location: 'Location' }, 'type'],
    [Report, { reportId: 'REP-1', caseId, preparedBy: officerId, reportType: 'Unknown', title: 'Title', content: 'Content', reportDate: new Date() }, 'reportType'],
  ];

  for (const [Model, document, field] of cases) {
    const error = await validationError(Model, document);
    assert.equal(error?.errors[field]?.kind, 'enum', `${Model.modelName}.${field} should enforce its enum`);
  }
});

test('officer badge numbers must be exactly six alphanumeric characters', async () => {
  const baseOfficer = validDocuments.find(([Model]) => Model === Officer)[1];

  for (const badgeNumber of ['ABCDE', 'ABCDEFG', 'ABC12!']) {
    const error = await validationError(Officer, { ...baseOfficer, badgeNumber });
    assert.equal(error?.errors.badgeNumber?.kind, 'regexp', `${badgeNumber} should be rejected`);
  }

  assert.equal(await validationError(Officer, { ...baseOfficer, badgeNumber: 'aB1234' }), undefined);
});

test('FIR geographic coordinates accept valid boundaries and reject out-of-range values', async () => {
  const baseFIR = validDocuments.find(([Model]) => Model === FIR)[1];
  assert.equal(await validationError(FIR, { ...baseFIR, latitude: -90, longitude: 180 }), undefined);
  assert.equal(await validationError(FIR, { ...baseFIR, latitude: 90, longitude: -180 }), undefined);

  const invalidLatitude = await validationError(FIR, { ...baseFIR, latitude: 90.01, longitude: 0 });
  assert.equal(invalidLatitude?.errors.latitude?.kind, 'max');
  const invalidLongitude = await validationError(FIR, { ...baseFIR, latitude: 0, longitude: -180.01 });
  assert.equal(invalidLongitude?.errors.longitude?.kind, 'min');
})
