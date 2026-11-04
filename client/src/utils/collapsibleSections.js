export const toggleSectionId = (expandedIds, sectionId) => (
  expandedIds.includes(sectionId)
    ? expandedIds.filter((id) => id !== sectionId)
    : [...expandedIds, sectionId]
)

export const isSectionExpanded = (expandedIds, sectionId) => expandedIds.includes(sectionId)
