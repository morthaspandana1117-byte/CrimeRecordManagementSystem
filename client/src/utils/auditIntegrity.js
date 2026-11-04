export const auditIntegrityPresentation = (integrity) => {
  const legacyRecords = Number(integrity?.unprotectedRecords ?? integrity?.legacyRecords ?? 0)
  const malformedRecords = Number(integrity?.malformedRecords || 0)

  if (!integrity?.valid) {
    return {
      title: 'Integrity verification failed',
      statusLabel: 'Issues detected',
      statusClass: 'status-rejected',
      cardClass: 'audit-integrity-invalid',
      alertClass: 'alert-danger',
      notice: integrity?.issue
        ? `Protected hash-chain verification failed: ${integrity.issue}.`
        : 'Protected hash-chain verification failed. Review the integrity issue before relying on the chain.',
    }
  }

  if (malformedRecords > 0) {
    return {
      title: 'Integrity verification requires attention',
      statusLabel: 'Malformed records',
      statusClass: 'status-pending',
      cardClass: 'audit-integrity-invalid',
      alertClass: 'alert-warning',
      notice: `${malformedRecords.toLocaleString()} audit record${malformedRecords === 1 ? ' has' : 's have'} incomplete integrity data.`,
    }
  }

  if (legacyRecords > 0) {
    return {
      title: 'Hash chain valid',
      statusLabel: 'Protected chain valid',
      statusClass: 'status-approved',
      cardClass: 'audit-integrity-valid',
      alertClass: 'alert-info',
      notice: `Hash chain verification passed. However, ${legacyRecords.toLocaleString()} historical audit record${legacyRecords === 1 ? '' : 's'} ${legacyRecords === 1 ? 'is' : 'are'} not covered by hash-chain protection. New audit records are protected.`,
    }
  }

  return {
    title: 'Hash chain valid',
    statusLabel: 'All records protected',
    statusClass: 'status-approved',
    cardClass: 'audit-integrity-valid',
    alertClass: 'alert-success',
    notice: 'Hash chain verification passed. All audit records are covered by hash-chain protection.',
  }
}
