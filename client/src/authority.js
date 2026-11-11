export const officerRanks = ['investigating_officer', 'sp', 'dsp', 'inspector', 'si', 'asi', 'head_constable', 'constable']
export const officerRankOptions = [
	{ value: 'sp', label: 'SP' },
	{ value: 'dsp', label: 'DSP' },
	{ value: 'inspector', label: 'Inspector' },
	{ value: 'si', label: 'SI' },
	{ value: 'asi', label: 'ASI' },
	{ value: 'head_constable', label: 'Head Constable' },
	{ value: 'constable', label: 'Constable' },
]
export const seniorOfficerRanks = ['inspector', 'dsp', 'sp']
export const officerManagementRanks = ['sp', 'dsp', 'inspector', 'si', 'asi', 'head_constable', 'constable']
export const seniorOfficerManagementRanks = ['sp', 'dsp', 'inspector', 'si']

export const getSystemRole = (user) => user?.systemRole || (user?.role === 'admin' ? 'system_admin' : user?.role === 'officer' ? 'officer' : null)
const rankAliases = {
	constable: 'constable',
	'head constable': 'head_constable',
	head_constable: 'head_constable',
	asi: 'asi',
	si: 'si',
	inspector: 'inspector',
	dsp: 'dsp',
	sp: 'sp',
}
export const getRank = (user) => {
	const rank = typeof user?.rank === 'string' ? user.rank.trim().toLowerCase() : ''
	return officerRanks.includes(rank) ? rank : rankAliases[rank] || null
}
export const getManagementRank = (user) => {
	const resolvedManagementRank = typeof user?.managementRank === 'string' ? user.managementRank.trim().toLowerCase() : ''
	if (officerManagementRanks.includes(resolvedManagementRank)) return resolvedManagementRank
	const rank = typeof user?.rank === 'string' ? user.rank.trim().toLowerCase() : ''
	return officerManagementRanks.includes(rank) ? rank : null
}
export const isSystemAdmin = (user) => getSystemRole(user) === 'system_admin'
export const isOfficer = (user) => getSystemRole(user) === 'officer'
export const canCheckEvidenceIntegrity = (user) => isOfficer(user) && seniorOfficerRanks.includes(getRank(user))
export const isSeniorOfficer = (user) => isOfficer(user) && seniorOfficerRanks.includes(getRank(user))
export const canManageOfficers = (user) => isSystemAdmin(user) || (isOfficer(user) && seniorOfficerManagementRanks.includes(getManagementRank(user)))
