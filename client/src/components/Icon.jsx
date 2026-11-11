const iconPaths = {
  dashboard: <><rect height="7" rx="1.5" width="7" x="3" y="3" /><rect height="7" rx="1.5" width="7" x="14" y="3" /><rect height="7" rx="1.5" width="7" x="3" y="14" /><rect height="7" rx="1.5" width="7" x="14" y="14" /></>,
  cases: <><path d="M3 7.5A2.5 2.5 0 015.5 5h4l2 2h7A2.5 2.5 0 0121 9.5v8a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z" /><path d="M3 10h18" /></>,
  file: <><path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M14 3v5h5M8 13h8M8 17h8" /></>,
  map: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1116 0z" /><circle cx="12" cy="10" r="2.5" /></>,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></>,
  users: <><path d="M16 20v-1.5a4 4 0 00-4-4H8a4 4 0 00-4 4V20" /><circle cx="10" cy="7" r="3.5" /><path d="M17 4.2a3.5 3.5 0 010 6.6M20 20v-1.5a4 4 0 00-3-3.87" /></>,
  chart: <><path d="M4 20V4M4 20h17" /><path d="M8 16v-4M13 16V8M18 16V5" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="M16 16l5 5" /></>,
  building: <><path d="M4 21V5a2 2 0 012-2h8v18M14 8h4a2 2 0 012 2v11M2 21h20" /><path d="M8 7h2M8 11h2M8 15h2M17 12h1M17 16h1" /></>,
  history: <><path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.4 2.6L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  'user-circle': <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M6.8 18a6 6 0 0110.4 0" /></>,
  shield: <><path d="M12 3l8 3v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3m9-7h6a2 2 0 012 2v10a2 2 0 01-2 2h-6" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
}

function Icon({ name, size = 20, className }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size}>
      {iconPaths[name] || iconPaths.file}
    </svg>
  )
}

export default Icon
