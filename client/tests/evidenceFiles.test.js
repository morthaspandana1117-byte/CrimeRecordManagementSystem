import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEvidenceFormData,
  evidenceItemsFromResponse,
  applyEvidenceVerificationResponse,
  evidenceCategories,
  evidenceListRequestConfig,
  evidenceFileMaxBytes,
  evidenceVerificationLabel,
  hasPrivateEvidenceFile,
  safeEvidenceDownloadFilename,
  validateEvidenceFile,
} from '../src/utils/evidenceFiles.js'

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
