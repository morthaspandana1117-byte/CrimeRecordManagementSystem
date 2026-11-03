export const evidenceCategories = ['Document', 'Photograph', 'Video', 'Weapon', 'Biological', 'Digital', 'Physical', 'Other']
export const integrityResultLabel = (result) => ({
  intact: 'Intact – original and current hashes match.',
  modified: 'Modified – current file hash differs from the original.',
  missing: 'Missing – stored evidence file is unavailable.',
}[result] || '')
export const integrityCheckButtonLabel = (checking) => checking ? 'Checking...' : 'Integrity Check'
export const integrityCheckErrorMessage = (errorCode) => errorCode === 'EVIDENCE_HASH_UNAVAILABLE'
  ? 'The original upload hash is unavailable, so integrity could not be confirmed.'
  : 'The integrity check could not be completed. Please try again or contact an administrator.'

export const evidenceFileMaxBytes = 10 * 1024 * 1024

export const evidenceFileAccept = '.pdf,application/pdf,image/jpeg,image/png,image/gif,image/webp'

const supportedEvidenceMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function validateEvidenceFile(file) {
  if (!file) return ''
  if (!supportedEvidenceMimeTypes.has(file.type)) {
    return 'Choose a PDF, JPEG, PNG, GIF, or WebP file. The file content must match its format.'
  }
  if (file.size > evidenceFileMaxBytes) {
    return 'Evidence files must be 10 MB or smaller.'
  }
  return ''
}

export function createEvidenceFormData(metadata, file) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) formData.append(key, String(value))
  }
  formData.append('file', file, file.name)
  return formData
}

export function safeEvidenceDownloadFilename(value, fallback = 'evidence') {
  const safeName = Array.from(String(value || fallback), (character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 32 || code === 127 ? '_' : character
  }).join('')
    .replace(/[^\w.() -]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 150)
  return safeName || fallback
}

export function hasPrivateEvidenceFile(record) {
  return record?.hasFile === true
}

export function evidenceVerificationLabel(record) {
  return record?.verificationStatus === 'verified' ? 'Verified' : 'Verify'
}

export function applyEvidenceVerificationResponse(record, response) {
  const verifiedRecord = response?.data?.data
  if (
    !record ||
    String(verifiedRecord?._id) !== String(record._id) ||
    verifiedRecord?.verificationStatus !== 'verified'
  ) return record

  return { ...record, verificationStatus: 'verified' }
}

export function evidenceItemsFromResponse(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : []
}

export function evidenceListRequestConfig(params = {}) {
  return { params, headers: { 'Cache-Control': 'no-cache' } }
}
