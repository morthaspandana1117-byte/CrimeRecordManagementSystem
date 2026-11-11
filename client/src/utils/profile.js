const rankLabels = {
  sp: 'SP',
  dsp: 'DSP',
  inspector: 'Inspector',
  si: 'SI',
  asi: 'ASI',
  head_constable: 'Head Constable',
  constable: 'Constable',
  investigating_officer: 'Investigating Officer',
}

const formatDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

const formatValue = (value) => value
  ? String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  : null

export const buildProfileFields = (profile) => {
  const fields = [
    ['Username', profile.username],
    ['Email address', profile.email],
    ['Role', profile.systemRole === 'system_admin' ? 'System Admin' : 'Police Officer'],
    ['Account approval', formatValue(profile.status)],
    ['Account status', typeof profile.isActive === 'boolean' ? (profile.isActive ? 'Active' : 'Inactive') : null],
    ['Account created', formatDate(profile.createdAt)],
  ]

  if (profile.systemRole === 'officer') {
    fields.unshift(['Full name', profile.name])
    fields.splice(3, 0,
      ['Police ID', profile.officerId],
      ['Badge number', profile.badgeNumber],
      ['Phone number', profile.phoneNumber],
      ['Police rank', rankLabels[profile.rank] || formatValue(profile.rank)],
      ['Department', formatValue(profile.department)],
      ['Assigned police station', profile.assignedStation],
      ['Employment status', formatValue(profile.employmentStatus)],
      ['Joining date', formatDate(profile.joiningDate)],
    )
  }

  return fields.filter(([, value]) => value !== null && value !== undefined && value !== '')
}
