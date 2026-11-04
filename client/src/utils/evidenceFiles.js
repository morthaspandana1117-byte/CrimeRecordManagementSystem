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

const downloadOutcomeDescription = {
  case_access_denied: 'case access denied',
  evidence_not_found: 'evidence not found',
  file_missing: 'stored file missing',
  invalid_stored_file: 'stored file unavailable',
  invalid_evidence_id: 'invalid evidence ID',
  storage_error: 'storage unavailable',
  stream_failed: 'stream failed',
  stream_interrupted: 'transfer interrupted',
}

const integrityOutcomeDescription = {
  intact: 'Intact',
  modified: 'Modified',
  missing: 'Missing',
  error: 'Check failed',
}

export function evidenceHistoryDescription(event) {
  switch (event?.action) {
    case 'EVIDENCE_FILE_UPLOADED': return 'Evidence uploaded'
    case 'EVIDENCE_FILE_DOWNLOADED': return 'Evidence downloaded successfully'
    case 'EVIDENCE_FILE_DOWNLOAD_FAILED': {
      const outcome = downloadOutcomeDescription[event.details?.downloadOutcome]
      return outcome ? `Evidence download failed — ${outcome}` : 'Evidence download failed'
    }
    case 'EVIDENCE_VERIFIED': return 'Evidence verified'
    case 'EVIDENCE_REJECTED': return 'Evidence rejected'
    case 'EVIDENCE_CUSTODY_TRANSFER_INITIATED': return 'Evidence custody transfer initiated'
    case 'EVIDENCE_CUSTODY_TRANSFER_ACKNOWLEDGED': return 'Evidence custody transfer acknowledged'
    case 'EVIDENCE_INTEGRITY_CHECKED': {
      const result = integrityOutcomeDescription[event.details?.integrityResult]
      return result ? `Evidence integrity checked — ${result}` : 'Evidence integrity checked'
    }
    default: {
      const readableAction = String(event?.action || 'Evidence event')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .join(' ')
      return readableAction ? `${readableAction[0].toUpperCase()}${readableAction.slice(1)}` : 'Evidence event'
    }
  }
}

export function evidenceHistoryItemsFromResponse(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : []
}

export function evidenceHistoryPaginationFromResponse(response) {
  const pagination = response?.data?.pagination
  return {
    page: Number.isInteger(pagination?.page) ? pagination.page : 1,
    limit: Number.isInteger(pagination?.limit) ? pagination.limit : 50,
    totalRecords: Number.isInteger(pagination?.totalRecords) ? pagination.totalRecords : 0,
    totalPages: Number.isInteger(pagination?.totalPages) ? pagination.totalPages : 1,
  }
}

export function evidenceHistoryRequestConfig(evidenceId, params = {}) {
  return { url: `/evidence/${encodeURIComponent(evidenceId)}/history`, params }
}

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

export const evidenceReportButtonLabel = (loading) => loading ? 'Generating...' : 'Download Evidence Report'
export const evidenceReportErrorMessage = (error) => error?.response?.data?.message
  || error?.response?.data?.error
  || 'The evidence report could not be generated.'

export function triggerEvidenceReportDownload(blob, filename, browser = {}) {
  const documentRef = browser.document || document
  const urlRef = browser.URL || window.URL
  const blobUrl = urlRef.createObjectURL(blob)
  const link = documentRef.createElement('a')
  link.href = blobUrl
  link.download = filename
  documentRef.body.appendChild(link)
  link.click()
  link.remove()
  const setTimeoutRef = browser.setTimeout || window.setTimeout
  setTimeoutRef(() => urlRef.revokeObjectURL(blobUrl), 1000)
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
