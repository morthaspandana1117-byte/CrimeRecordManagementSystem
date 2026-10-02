export const officerRanks = ['investigating_officer', 'inspector', 'dsp', 'sp']
export const officerRankOptions = [
	{ value: 'investigating_officer', label: 'Investigating Officer' },
	{ value: 'inspector', label: 'Inspector' },
	{ value: 'dsp', label: 'DSP' },
	{ value: 'sp', label: 'SP' },
]
export const seniorOfficerRanks = ['inspector', 'dsp', 'sp']

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
export const isSystemAdmin = (user) => getSystemRole(user) === 'system_admin'
export const isOfficer = (user) => getSystemRole(user) === 'officer'
export const isSeniorOfficer = (user) => seniorOfficerRanks.includes(getRank(user))
export const canManageOfficers = (user) => isSystemAdmin(user) || isSeniorOfficer(user)
