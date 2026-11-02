import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEvidenceFormData,
  evidenceCategories,
  evidenceFileMaxBytes,
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
