import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEvidenceFormData,
  evidenceItemsFromResponse,
  applyEvidenceVerificationResponse,
  evidenceCategories,
  evidenceListRequestConfig,
  evidenceHistoryDescription,
  evidenceHistoryItemsFromResponse,
  evidenceHistoryPaginationFromResponse,
  evidenceHistoryRequestConfig,
  evidenceFileMaxBytes,
  evidenceVerificationLabel,
  hasPrivateEvidenceFile,
  integrityCheckButtonLabel,
  integrityCheckErrorMessage,
  integrityResultLabel,
  safeEvidenceDownloadFilename,
  validateEvidenceFile,
} from '../src/utils/evidenceFiles.js'
import { canCheckEvidenceIntegrity } from '../src/authority.js'

test('evidence category values match the backend enum exactly', () => {
  assert.deepEqual(evidenceCategories, ['Document', 'Photograph', 'Video', 'Weapon', 'Biological', 'Digital', 'Physical', 'Other'])
})

test('PDF selection is accepted and multipart upload includes metadata and the file field', () => {
  const file = Object.assign(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), { name: 'scene.pdf' })
  assert.equal(validateEvidenceFile(file), '')

  const formData = createEvidenceFormData({ evidenceId: 'EV-1', type: 'Document', status: 'Collected' }, file)
  assert.equal(formData.get('evidenceId'), 'EV-1')
  assert.equal(formData.get('type'), 'Document')
  assert.equal(formData.get('status'), 'Collected')
  assert.equal(formData.get('file').name, 'scene.pdf')
})

test('unsupported MIME types and files over the default server limit receive useful validation errors', () => {
  assert.match(validateEvidenceFile({ type: 'text/plain', size: 10 }), /PDF, JPEG, PNG, GIF, or WebP/)
  assert.match(validateEvidenceFile({ type: 'application/pdf', size: evidenceFileMaxBytes + 1 }), /10 MB or smaller/)
})

test('download visibility depends only on private file metadata and filenames are sanitized', () => {
  assert.equal(hasPrivateEvidenceFile({ hasFile: true, fileUrl: '' }), true)
  assert.equal(hasPrivateEvidenceFile({ hasFile: false, fileUrl: 'https://legacy.test/file.pdf' }), false)
  assert.equal(hasPrivateEvidenceFile({ fileUrl: 'https://legacy.test/file.pdf' }), false)
  assert.equal(safeEvidenceDownloadFilename('../case\r\nsecret.pdf'), '_case__secret.pdf')
})

test('integrity check action is limited to inspector, DSP, and SP officers', () => {
  for (const rank of ['inspector', 'dsp', 'sp']) {
    assert.equal(canCheckEvidenceIntegrity({ role: 'officer', rank }), true)
  }
  assert.equal(canCheckEvidenceIntegrity({ role: 'officer', rank: 'investigating_officer' }), false)
  assert.equal(canCheckEvidenceIntegrity({ role: 'admin', rank: 'sp' }), false)
})

test('integrity outcomes have clear labels and unknown results are not presented as success', () => {
  assert.match(integrityResultLabel('intact'), /hashes match/)
  assert.match(integrityResultLabel('modified'), /differs from the original/)
  assert.match(integrityResultLabel('missing'), /file is unavailable/)
  assert.equal(integrityResultLabel('error'), '')
})

test('integrity check exposes a loading label and safe generic failures', () => {
  assert.equal(integrityCheckButtonLabel(false), 'Integrity Check')
  assert.equal(integrityCheckButtonLabel(true), 'Checking...')
  assert.match(integrityCheckErrorMessage('EVIDENCE_HASH_UNAVAILABLE'), /original upload hash is unavailable/)
  assert.match(integrityCheckErrorMessage('SERVER_ERROR'), /could not be completed/)
  assert.doesNotMatch(integrityCheckErrorMessage('C:\\private-evidence\\secret'), /private-evidence|secret/)
})

test('evidence history request targets the selected evidence and includes pagination parameters', () => {
  assert.deepEqual(evidenceHistoryRequestConfig('evidence/with space', { page: 2, limit: 25 }), {
    url: '/evidence/evidence%2Fwith%20space/history',
    params: { page: 2, limit: 25 },
  })
})

test('evidence history events use readable labels for existing audit actions', () => {
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_FILE_UPLOADED' }), 'Evidence uploaded')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_FILE_DOWNLOADED' }), 'Evidence downloaded successfully')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_FILE_DOWNLOAD_FAILED', details: { downloadOutcome: 'stream_interrupted' } }), 'Evidence download failed — transfer interrupted')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_VERIFIED' }), 'Evidence verified')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_REJECTED' }), 'Evidence rejected')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_CUSTODY_TRANSFER_INITIATED' }), 'Evidence custody transfer initiated')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_CUSTODY_TRANSFER_ACKNOWLEDGED' }), 'Evidence custody transfer acknowledged')
  assert.equal(evidenceHistoryDescription({ action: 'EVIDENCE_INTEGRITY_CHECKED', details: { integrityResult: 'missing' } }), 'Evidence integrity checked — Missing')
})

test('evidence history response parsing supports empty data and pagination defaults', () => {
  const response = { data: { data: [{ id: 'event-1' }], pagination: { page: 2, limit: 2, totalRecords: 3, totalPages: 2 } } }
  assert.deepEqual(evidenceHistoryItemsFromResponse(response), [{ id: 'event-1' }])
  assert.deepEqual(evidenceHistoryPaginationFromResponse(response), { page: 2, limit: 2, totalRecords: 3, totalPages: 2 })
  assert.deepEqual(evidenceHistoryItemsFromResponse({}), [])
  assert.deepEqual(evidenceHistoryPaginationFromResponse({}), { page: 1, limit: 50, totalRecords: 0, totalPages: 1 })
})

test('uploaded unverified evidence displays Download and Verify before verification', () => {
  const item = { _id: 'evidence-1', hasFile: true, verificationStatus: 'unverified' }
  assert.equal(hasPrivateEvidenceFile(item), true)
  assert.equal(evidenceVerificationLabel(item), 'Verify')
})

test('successful verification changes Verify to Verified while Download remains available', () => {
  const item = { _id: 'evidence-1', hasFile: true, verificationStatus: 'unverified' }
  const updated = applyEvidenceVerificationResponse(item, {
    data: { data: { _id: 'evidence-1', verificationStatus: 'verified' } },
  })
  assert.equal(evidenceVerificationLabel(updated), 'Verified')
  assert.equal(hasPrivateEvidenceFile(updated), true)
})

test('verification stays pending without a matching successful verified response', () => {
  const item = { _id: 'evidence-1', hasFile: true, verificationStatus: 'unverified' }
  assert.equal(applyEvidenceVerificationResponse(item, {}), item)
  assert.equal(applyEvidenceVerificationResponse(item, {
    data: { data: { _id: 'evidence-2', verificationStatus: 'verified' } },
  }), item)
  assert.equal(applyEvidenceVerificationResponse(item, {
    data: { data: { _id: 'evidence-1', verificationStatus: 'rejected' } },
  }), item)
  assert.equal(evidenceVerificationLabel(item), 'Verify')
})

test('evidence without a private file has no Download regardless of verification state', () => {
  const item = { _id: 'evidence-2', hasFile: false, verificationStatus: 'verified' }
  assert.equal(hasPrivateEvidenceFile(item), false)
  assert.equal(evidenceVerificationLabel(item), 'Verified')
})

test('rejected evidence keeps the Verify label and does not affect the separate Reject action', () => {
  const item = { _id: 'evidence-3', hasFile: false, verificationStatus: 'rejected' }
  assert.equal(evidenceVerificationLabel(item), 'Verify')
  assert.equal(hasPrivateEvidenceFile(item), false)
})

test('case evidence loader accepts the API envelope and preserves hasFile booleans', () => {
  const records = [{ _id: 'evidence-1', hasFile: true }, { _id: 'evidence-2', hasFile: false }]
  assert.deepEqual(evidenceItemsFromResponse({ data: { success: true, data: records } }), records)
  assert.deepEqual(evidenceItemsFromResponse({ data: { success: true, data: { records } } }), [])
})

test('evidence list requests revalidate cached data after returning to a case', () => {
  const request = evidenceListRequestConfig({ caseId: 'case-1' })
  assert.deepEqual(request.params, { caseId: 'case-1' })
  assert.equal(request.headers['Cache-Control'], 'no-cache')
})
