const g = document.getElementById.bind(document)
const q = sel => document.querySelectorAll(sel)

agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule, agGrid.AllEnterpriseModule])

const gridTheme = agGrid.themeQuartz.withParams({
  backgroundColor: 'var(--color-lightest)',
  borderColor: 'var(--color-light)',
  foregroundColor: 'var(--color-darkest)',
  headerBackgroundColor: 'transparent',
  headerTextColor: 'var(--color-darker)',
  rowBorder: { color: 'var(--color-light)', style: 'solid', width: 1 },
  rowHoverColor: 'var(--color-lighter)',
})

const modeIcons = { dark: 'fa-moon', light: 'fa-sun-bright' }
const setMode = mode => {
  window.api.setTheme(mode)
  localStorage.setItem('mode', mode)
  g('mode-icon').className = `fa-solid ${modeIcons[mode]}`
  g('mode-label').textContent = mode === 'dark' ? 'Dark' : 'Light'
}

g('mode').addEventListener('click', () => setMode(localStorage.getItem('mode') === 'dark' ? 'light' : 'dark'))
setMode(localStorage.getItem('mode') || 'dark')

const grids = {}
const sizeGrid = g => { g.autoSizeAllColumns(); g.sizeColumnsToFit() }
const gridDefaults = {
  defaultColDef: { filter: 'agTextColumnFilter', resizable: false, sortable: true, suppressSizeToFit: true },
  popupParent: document.body,
  theme: gridTheme,
}

const fmtCompact = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
const fmtCost = p => p.value != null ? `$${p.value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'
const fmtDate = p => new Date(p.value).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
const fmtDuration = p => { const m = p.value; if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`; return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
const fmtNum = p => p.value?.toLocaleString()
const fmtRelativeReset = str => {
  if (!str) return ''
  const now = new Date()
  let target
  const dateMatch = str.match(/(\w+)\s+(\d+)\s+at\s+(\d+):?(\d*)([ap]m)/)
  const timeMatch = str.match(/^(\d+):?(\d*)([ap]m)/)
  if (dateMatch) {
    const [, mon, day, h, min, ap] = dateMatch
    target = new Date(`${mon} ${day}, ${now.getFullYear()} ${(ap === 'pm' && +h !== 12 ? +h + 12 : ap === 'am' && +h === 12 ? 0 : +h)}:${min || '00'}`)
    if (target < now) target.setFullYear(target.getFullYear() + 1)
  } else if (timeMatch) {
    const [, h, min, ap] = timeMatch
    target = new Date(now)
    target.setHours(ap === 'pm' && +h !== 12 ? +h + 12 : ap === 'am' && +h === 12 ? 0 : +h, +(min || 0), 0, 0)
    if (target < now) target.setDate(target.getDate() + 1)
  }
  if (!target) return ''
  const diff = Math.round((target - now) / 60000)
  if (diff < 60) return `resets in ${diff}m`
  if (diff < 1440) return `resets in ${Math.round(diff / 60)}h`
  return `resets in ${Math.round(diff / 1440)}d`
}
const fmtRate = p => p.value != null ? `$${p.value}` : '—'

const initGrid = (pageId, columnDefs, data) => {
  grids[pageId] = agGrid.createGrid(g(pageId).querySelector('.grid-container'), {
    ...gridDefaults,
    columnDefs: columnDefs.map(c => c.filter === false ? { ...c, suppressHeaderMenuButton: true } : c),
    rowData: data,
  })
  sizeGrid(grids[pageId])
}

const pages = {
  home: {
    data: window.api.loadHome(),
    render: d => {
      const now = new Date()
      g('today-big').textContent = `${now.toLocaleDateString('en-US', { weekday: 'long' })}\n${now.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`
      g('today-sub').textContent = `${d.today.sessions} sessions · ${d.today.turns.toLocaleString()} turns · ${fmtCompact(d.today.tokens)} tokens · $${d.today.cost.toFixed(2)}`
      g('sessions-big').textContent = `${d.sessions.total}\nsessions`
      g('sessions-sub').textContent = `${d.sessions.turns.toLocaleString()} turns`
      g('memories-big').textContent = `${d.memories.total}\nmemories`
      g('memories-sub').textContent = `${d.memories.feedback} feedback · ${d.memories.project} project`
      g('rules-big').textContent = `${d.rules.total}\nrules`
      g('rules-sub').textContent = `${d.rules.global} global · ${d.rules.project} project`
      g('tools-big').textContent = `${d.tools.unique}\ntools`
      g('tools-sub').textContent = `${fmtCompact(d.tools.total)} calls · ${d.tools.top3}`
      if (d.plan) {
        const resetStr = d.plan.session.resets ? fmtRelativeReset(d.plan.session.resets) : ''
        g('plan-big').textContent = `${d.plan.session.pct ?? '?'}%\n${resetStr}`
        const weekReset = d.plan.week.resets ? fmtRelativeReset(d.plan.week.resets) : ''
        g('plan-sub').textContent = `${d.plan.week.pct ?? '?'}% weekly · ${weekReset}`
      } else { g('plan-big').textContent = '...'; g('plan-sub').textContent = 'Loading' }
      g('usage-plan-pct').textContent = d.plan?.session.pct != null ? `${d.plan.session.pct}%` : ''
      if (d.plan) renderPlanDetail(d.plan)
      g('settings-big').textContent = `${d.settings.total}\nsettings`
      g('settings-sub').textContent = `${d.settings.allow} allow · ${d.settings.deny} deny`
      g('usage-big').textContent = `$${d.stats.allTimeCost.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
      g('usage-sub').textContent = `${fmtCompact(d.stats.allTimeTokens)} tokens · all time`
    },
  },
  memories: {
    columnDefs: [
      { field: 'type', headerName: 'Type' },
      { field: 'name', headerName: 'Name' },
      { field: 'project', headerName: 'Path' },
      { field: 'description', headerName: 'Description', suppressSizeToFit: false },
    ],
    data: window.api.loadMemories(),
  },
  rules: {
    columnDefs: [
      { field: 'scope', headerName: 'Scope' },
      { field: 'source', headerName: 'Source' },
      { field: 'content', headerName: 'Content', suppressSizeToFit: false },
    ],
    data: window.api.loadRules(),
  },
  sessions: {
    columnDefs: [
      { field: 'start', filter: false, headerName: 'Date', sort: 'desc', valueFormatter: fmtDate },
      { field: 'source', headerName: 'Source' },
      { field: 'name', headerName: 'Name' },
      { field: 'aiTitle', headerName: 'AI Title', hide: true },
      { field: 'project', headerName: 'Path' },
      { field: 'firstDisplay', headerName: 'First Message', hide: true, suppressSizeToFit: false },
      { field: 'lastDisplay', headerName: 'Last Message', suppressSizeToFit: false },
      { field: 'turns', filter: false, headerName: 'Turns', type: 'numericColumn' },
      { field: 'duration', filter: false, headerName: 'Duration', type: 'numericColumn', valueFormatter: fmtDuration },
    ],
    data: window.api.loadSessions(),
  },
  goodies: {
    data: window.api.loadGoodies(),
    render: d => {
      g('goodie-tray').checked = d.tray
      g('goodie-widget').checked = d.widget
      g('goodie-plan-refresh').value = d.planRefresh || 0
      const save = () => window.api.setGoodies({ planRefresh: parseInt(g('goodie-plan-refresh').value), tray: g('goodie-tray').checked, widget: g('goodie-widget').checked })
      g('goodie-tray').addEventListener('change', save)
      g('goodie-widget').addEventListener('change', save)
      g('goodie-plan-refresh').addEventListener('change', save)
    },
  },
  'settings-page': {
    columnDefs: [
      { field: 'scope', headerName: 'Scope' },
      { field: 'key', headerName: 'Key', sort: 'asc' },
      { field: 'value', headerName: 'Value', suppressSizeToFit: false },
      { field: 'source', headerName: 'Source' },
    ],
    data: window.api.loadSettings(),
  },
  tools: {
    columnDefs: [
      { field: 'name', headerName: 'Tool', suppressSizeToFit: false },
      { field: 'calls', filter: false, headerName: 'Calls', sort: 'desc', type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'pct', filter: false, headerName: '%', type: 'numericColumn' },
    ],
    data: window.api.loadTools(),
  },
  usage: {
    columnDefs: [
      { field: 'model', headerName: 'Model', suppressSizeToFit: false },
      { field: 'inputTokens', filter: false, headerName: 'Input', type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'inputRate', filter: false, headerName: 'In $', type: 'numericColumn', valueFormatter: fmtRate },
      { field: 'outputTokens', filter: false, headerName: 'Output', type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'outputRate', filter: false, headerName: 'Out $', type: 'numericColumn', valueFormatter: fmtRate },
      { field: 'cacheReadInputTokens', filter: false, headerName: 'Cache Read', type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'cacheReadRate', filter: false, headerName: 'Read $', type: 'numericColumn', valueFormatter: fmtRate },
      { field: 'cacheCreationInputTokens', filter: false, headerName: 'Cache Write', type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'cacheWriteRate', filter: false, headerName: 'Write $', type: 'numericColumn', valueFormatter: fmtRate },
      { field: 'cost', filter: false, headerName: 'Cost', type: 'numericColumn', valueFormatter: fmtCost },
    ],
    data: window.api.loadStats(),
    transform: d => d.models,
  },
}

for (const [id, page] of Object.entries(pages)) {
  if (page.data) page.data.then(d => {
    const countEl = g(`${id}-count`)
    if (countEl) countEl.textContent = (page.transform ? page.transform(d) : d).length
  })
}

const showPage = async pageId => {
  q('[data-page]').forEach(b => b.classList.remove('active'))
  q('.page').forEach(p => p.classList.remove('active'))
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active')
  g(pageId)?.classList.add('active')
  if (grids[pageId]) return sizeGrid(grids[pageId])
  const page = pages[pageId]
  if (!page) return
  const d = await page.data
  if (page.render) page.render(d)
  if (page.columnDefs) initGrid(pageId, page.columnDefs, page.transform ? page.transform(d) : d)
}

q('[data-page]').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)))
q('[data-nav]').forEach(card => card.addEventListener('click', () => showPage(card.dataset.nav)))
g('sidebar-toggle').addEventListener('click', () => g('side').classList.toggle('collapsed'))

const tmpl = g('grid-page-template')
q('[data-page]:not([data-page="home"]):not([data-page="goodies"])').forEach(nav => {
  const page = tmpl.content.cloneNode(true).firstElementChild
  page.id = nav.dataset.page
  page.querySelector(':scope > .page-header > i').className = nav.querySelector('i').className
  page.querySelector('strong').textContent = nav.querySelector('span').textContent
  g('main').appendChild(page)
})

const statsNote = document.createElement('small')
statsNote.textContent = 'All rates are per million tokens'
statsNote.style.color = 'var(--color-half)'
g('usage').querySelector('.page-header').appendChild(statsNote)

const planSection = document.createElement('div')
planSection.id = 'plan-detail'
planSection.className = 'plan-section'
planSection.innerHTML = '<div class="plan-loading">Loading plan data...</div>'
g('usage').querySelector('.page-header').after(planSection)

const renderPlanDetail = p => {
  if (!p) { planSection.innerHTML = '<div class="plan-loading">Could not load plan data</div>'; return }
  const bar = (label, pct, resets) => `<div class="plan-row"><div class="plan-label">${label}</div><div class="plan-bar-track"><div class="plan-bar-fill" style="width:${pct}%"></div></div><div class="plan-pct">${pct}%</div>${resets ? `<div class="plan-reset">resets ${resets}</div>` : ''}</div>`
  planSection.innerHTML = bar('Session', p.session.pct ?? 0, p.session.resets) + bar('Weekly', p.week.pct ?? 0, p.week.resets)
}

q('[data-action]').forEach(btn => btn.addEventListener('click', () => {
  const page = btn.closest('.page')
  const grid = grids[page.id]
  if (!grid) return
  if (btn.dataset.action === 'filter') {
    const active = btn.classList.toggle('active')
    grid.setGridOption('defaultColDef', { ...gridDefaults.defaultColDef, floatingFilter: active })
  } else if (btn.dataset.action === 'columns') {
    grid.showColumnChooser()
  }
}))

g('spinner').classList.add('active')
window.api.onHomeUpdate(d => { pages.home.render(d); g('spinner').classList.remove('active') })

showPage('home')
