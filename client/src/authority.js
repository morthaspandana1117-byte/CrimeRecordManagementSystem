export const officerRanks = ['investigating_officer', 'inspector', 'dsp', 'sp']
export const officerRankOptions = [
	{ value: 'investigating_officer', label: 'Investigating Officer' },
	{ value: 'inspector', label: 'Inspector' },
	{ value: 'dsp', label: 'DSP' },
	{ value: 'sp', label: 'SP' },
]
export const seniorOfficerRanks = ['inspector', 'dsp', 'sp']
export const officerManagementRanks = ['sp', 'dsp', 'inspector', 'si', 'asi', 'head_constable', 'constable']
export const seniorOfficerManagementRanks = ['sp', 'dsp', 'inspector', 'si']

export const getSystemRole = (user) => user?.systemRole || (user?.role === 'admin' ? 'system_admin' : user?.role === 'officer' ? 'officer' : null)
const rankAliases = {
	constable: 'investigating_officer',
	'head constable': 'investigating_officer',
	asi: 'investigating_officer',
	si: 'investigating_officer',
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
export const isSeniorOfficer = (user) => seniorOfficerManagementRanks.includes(getManagementRank(user))
export const canManageOfficers = (user) => isSystemAdmin(user) || isSeniorOfficer(user)
