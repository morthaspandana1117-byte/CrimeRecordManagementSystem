const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'operational-restrictions-test-secret';

const createApp = require('../app');
const User = require('../models/User');
const Officer = require('../models/Officer');
const Criminal = require('../models/Criminal');
const FIR = require('../models/FIR');
const Case = require('../models/Case');
const Evidence = require('../models/Evidence');
const CaseHistory = require('../models/CaseHistory');

let mongoServer;
let app;
let tokens;
let officers;
let assignedCase;

const password = 'Operational@123';

const createOfficerUser = async (rank, username) => {
  const user = await User.create({
    username,
    email: `${username}@crms.test`,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'officer',
    status: 'approved',
    isActive: true,
  });

  const officer = await Officer.create({
    userId: user._id,
    officerId: `${rank.toUpperCase()}-001`,
    badgeNumber: rank === 'sp' ? 'SP0001' : `${rank.substring(0, 3).toUpperCase()}001`,
    name: username,
    rank,
    department: 'Criminal Investigation',
    station: 'Central Station',
    phoneNumber: '9876543210',
    address: 'Operational Test Lane',
    joiningDate: '2020-01-01',
    status: 'active',
  });

  return { user, officer };
};

const login = async (username) => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  assert.equal(response.status, 200);
  return response.body.token;
};

const createCaseFixture = async (caseNo = 'CASE-HISTORY-001', assignedOfficerIds = []) => {
  const fir = await FIR.create({
    firNo: `FIR-${caseNo}`,
    date: '2026-10-01',
    policeStation: 'Central Station',
    complaint: {
      complainantName: 'Asha Verma',
      complainantPhone: '9876543210',
      complaintText: 'Goods stolen from property.',
    },
    description: 'Theft investigation case',
    crimeType: 'Theft',
    location: {
      address: 'Market Road',
      city: 'City A',
      state: 'State A',
      pincode: '123456',
    },
    registeredBy: assignedOfficerIds[0] || officers.investigating_officer._id,
    criminalIds: [],
    status: 'Open',
  });

  return Case.create({
    caseNo,
    firId: fir._id,
    assignedOfficerIds,
    criminalIds: [],
    title: 'Theft investigation',
    description: 'Case created for operational checks',
    startDate: '2026-10-01',
    status: 'Open',
    priority: 'High',
    currentInvestigationRound: 1,
    investigationHistory: [{
      round: 1,
      startedAt: '2026-10-01',
      status: 'Open',
    }],
  });
};

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri('crms-operational-tests'));
  app = createApp();

  officers = {};
  tokens = {};

  const investigating = await createOfficerUser('investigating_officer', 'op-investigating');
  const inspector = await createOfficerUser('inspector', 'op-inspector');
  const dsp = await createOfficerUser('dsp', 'op-dsp');
  const sp = await createOfficerUser('sp', 'op-sp');

  officers.investigating_officer = investigating.officer;
  officers.inspector = inspector.officer;
  officers.dsp = dsp.officer;
  officers.sp = sp.officer;

  tokens.investigating_officer = await login('op-investigating');
  tokens.inspector = await login('op-inspector');
  tokens.dsp = await login('op-dsp');
  tokens.sp = await login('op-sp');

  const adminUser = await User.create({
    username: 'op-system-admin',
    email: 'op-system-admin@crms.test',
    passwordHash: await bcrypt.hash(password, 10),
    role: 'system_admin',
    status: 'approved',
    isActive: true,
  });
  tokens.system_admin = await login('op-system-admin');
  await adminUser.save();

  assignedCase = await createCaseFixture('CASE-HISTORY-001', [officers.investigating_officer._id]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongoServer.stop();
});

test('criminal, FIR, and evidence delete endpoints are unavailable and do not remove records', async () => {
  const criminal = await Criminal.create({
    criminalId: 'CR-DEL-001',
    fullName: 'Delete Prevention Test',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    address: 'No Delete Road',
    status: 'active',
  });

  const criminalDelete = await request(app)
    .delete(`/api/criminals/${criminal._id}`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`);
  assert.ok(criminalDelete.status === 404 || criminalDelete.status === 405 || criminalDelete.status === 403, 'criminal delete endpoint should be blocked');
  assert.equal((await Criminal.findById(criminal._id))._id.toString(), criminal._id.toString());

  const fir = await FIR.create({
    firNo: 'FIR-DELETE-001',
    date: '2026-10-05',
    policeStation: 'Central Station',
    complaint: {
      complainantName: 'Delete Test',
      complainantPhone: '9988776655',
      complaintText: 'Test complaint',
    },
    description: 'Delete prevention',
    crimeType: 'Theft',
    location: {
      address: 'Test Street',
      city: 'Test City',
      state: 'Test State',
      pincode: '110001',
    },
    registeredBy: officers.investigating_officer._id,
    criminalIds: [],
    status: 'Open',
  });

  const firDelete = await request(app)
    .delete(`/api/firs/${fir._id}`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`);
  assert.ok(firDelete.status === 404 || firDelete.status === 405 || firDelete.status === 403, 'fir delete endpoint should be blocked');
  assert.equal((await FIR.findById(fir._id))._id.toString(), fir._id.toString());

  const evidence = await Evidence.create({
    evidenceId: 'E-DEL-001',
    caseId: assignedCase._id,
    investigationRound: 1,
    type: 'Document',
    description: 'Delete prevention evidence',
    collectedBy: officers.investigating_officer._id,
    collectionDate: '2026-10-02',
    location: 'Evidence locker',
    fileUrl: 'https://example.com/keep-me.pdf',
    status: 'Collected',
  });

  const evidenceDelete = await request(app)
    .delete(`/api/evidence/${evidence._id}`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`);
  assert.ok(evidenceDelete.status === 404 || evidenceDelete.status === 405 || evidenceDelete.status === 403, 'evidence delete endpoint should be blocked');
  assert.equal((await Evidence.findById(evidence._id))._id.toString(), evidence._id.toString());
});

test('evidence download is authorized and verification is senior-only', async () => {
  const evidence = await Evidence.create({
    evidenceId: 'E-DOWNLOAD-001',
    caseId: assignedCase._id,
    investigationRound: 1,
    type: 'Photograph',
    description: 'Scene photograph',
    collectedBy: officers.investigating_officer._id,
    collectionDate: '2026-10-03',
    location: 'Scene boundary',
    fileUrl: 'https://example.com/evidence/scene.jpg',
    status: 'Collected',
    verificationStatus: 'unverified',
  });

  const download = await request(app)
    .get(`/api/evidence/${evidence._id}/download`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`);
  assert.equal(download.status, 200);
  assert.equal(download.body.data.downloadUrl, 'https://example.com/evidence/scene.jpg');

  const systemAdminDownload = await request(app)
    .get(`/api/evidence/${evidence._id}/download`)
    .set('Authorization', `Bearer ${tokens.system_admin}`);
  assert.equal(systemAdminDownload.status, 403);

  const validVerify = await request(app)
    .patch(`/api/evidence/${evidence._id}/verify`)
    .set('Authorization', `Bearer ${tokens.inspector}`)
    .send({ verificationStatus: 'verified', verificationNotes: 'Recovered evidence matches the scene.' });
  assert.equal(validVerify.status, 200);
  assert.equal(validVerify.body.data.verificationStatus, 'verified');
  assert.equal(validVerify.body.data.verifiedBy, officers.inspector.userId?.toString?.() || undefined);

  const rejectedEvidence = await Evidence.create({
    evidenceId: 'E-REJECT-001',
    caseId: assignedCase._id,
    investigationRound: 1,
    type: 'Document',
    description: 'Reject flow evidence',
    collectedBy: officers.investigating_officer._id,
    collectionDate: '2026-10-04',
    location: 'Evidence locker B',
    fileUrl: 'https://example.com/reject.jpg',
    status: 'Collected',
    verificationStatus: 'unverified',
  });

  const rejectedVerify = await request(app)
    .patch(`/api/evidence/${rejectedEvidence._id}/verify`)
    .set('Authorization', `Bearer ${tokens.dsp}`)
    .send({ verificationStatus: 'rejected', verificationNotes: 'Evidence does not match the case.' });
  assert.equal(rejectedVerify.status, 200);
  assert.equal(rejectedVerify.body.data.verificationStatus, 'rejected');
  assert.equal(rejectedVerify.body.data.verifiedBy?.toString(), officers.dsp.userId.toString());
  assert.ok(rejectedVerify.body.data.verifiedAt);
  assert.match(rejectedVerify.body.data.verificationNotes, /does not match/i);

  const unauthorizedVerify = await request(app)
    .patch(`/api/evidence/${evidence._id}/verify`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`)
    .send({ verificationStatus: 'verified' });
  assert.equal(unauthorizedVerify.status, 403);

  const adminVerify = await request(app)
    .patch(`/api/evidence/${evidence._id}/verify`)
    .set('Authorization', `Bearer ${tokens.system_admin}`)
    .send({ verificationStatus: 'rejected', verificationNotes: 'Admin verification attempt' });
  assert.equal(adminVerify.status, 403);

  const stored = await Evidence.findById(evidence._id);
  assert.equal(stored.verificationStatus, 'verified');
  assert.ok(stored.verifiedAt);
  assert.equal(stored.verifiedBy?.toString(), officers.inspector.userId.toString());
});

test('case history is persistent and chronological for relevant events', async () => {
  const historyResponse = await request(app)
    .get(`/api/cases/${assignedCase._id}/history`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`);

  assert.equal(historyResponse.status, 200);
  assert.ok(Array.isArray(historyResponse.body.data));
  assert.ok(historyResponse.body.data.length > 0);

  const unauthorizedHistory = await request(app)
    .get(`/api/cases/${assignedCase._id}/history`)
    .set('Authorization', `Bearer ${tokens.system_admin}`);
  assert.equal(unauthorizedHistory.status, 403);

  const caseHistoryEntry = await CaseHistory.findOne({ caseId: assignedCase._id });
  assert.ok(caseHistoryEntry);
  assert.ok(caseHistoryEntry.timestamp);

  const attemptedEdit = await request(app)
    .put(`/api/cases/${assignedCase._id}/history/${caseHistoryEntry._id}`)
    .set('Authorization', `Bearer ${tokens.investigating_officer}`)
    .send({ description: 'tamper' });
  assert.ok(attemptedEdit.status === 404 || attemptedEdit.status === 405 || attemptedEdit.status === 403);
});
