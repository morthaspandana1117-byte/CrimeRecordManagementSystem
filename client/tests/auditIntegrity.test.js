import assert from 'node:assert/strict'
import test from 'node:test'
import { auditIntegrityPresentation } from '../src/utils/auditIntegrity.js'

test('explains that a valid chain can exclude historical legacy records', () => {
  const presentation = auditIntegrityPresentation({
    valid: true,
    unprotectedRecords: 72,
    legacyRecords: 72,
    malformedRecords: 0,
  })

  assert.equal(presentation.title, 'Hash chain valid')
  assert.match(presentation.notice, /72 historical audit records are not covered/)
  assert.match(presentation.notice, /New audit records are protected/)
  assert.equal(presentation.alertClass, 'alert-info')
})

test('confirms complete protection when no legacy records exist', () => {
  const presentation = auditIntegrityPresentation({
    valid: true,
    protectedRecords: 10,
    unprotectedRecords: 0,
    malformedRecords: 0,
  })

  assert.equal(presentation.statusLabel, 'All records protected')
  assert.match(presentation.notice, /All audit records are covered/)
  assert.equal(presentation.alertClass, 'alert-success')
})

test('reports malformed records as an attention state', () => {
  const presentation = auditIntegrityPresentation({
    valid: true,
    malformedRecords: 2,
  })

  assert.equal(presentation.statusLabel, 'Malformed records')
  assert.match(presentation.notice, /2 audit records have incomplete integrity data/)
  assert.equal(presentation.alertClass, 'alert-warning')
})

test('reports chain failures as a failure state', () => {
  const presentation = auditIntegrityPresentation({
    valid: false,
    issue: 'MODIFIED_RECORD',
    malformedRecords: 0,
  })

  assert.equal(presentation.statusLabel, 'Issues detected')
  assert.match(presentation.notice, /MODIFIED_RECORD/)
  assert.equal(presentation.alertClass, 'alert-danger')
})
