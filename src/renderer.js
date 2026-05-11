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

const fmtCost = p => p.value != null ? `$${p.value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'
const fmtDate = p => new Date(p.value).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
const fmtDuration = p => { const m = p.value; if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`; return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
const fmtNum = p => p.value?.toLocaleString()
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
      g('today-big').innerHTML = `${now.toLocaleDateString('en-US', { weekday: 'long' })}<br>${now.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`
      g('today-sub').textContent = `${d.today.sessions} sessions · ${d.today.messages} messages · ${d.today.tokens.toLocaleString()} tokens · $${d.today.cost.toFixed(2)}`
      g('sessions-big').innerHTML = `${d.sessions.total}<br>sessions`
      g('sessions-sub').textContent = `${d.sessions.totalMessages.toLocaleString()} messages`
      g('memories-big').innerHTML = `${d.memories.total}<br>memories`
      g('memories-sub').textContent = `${d.memories.feedback} feedback · ${d.memories.project} project`
      g('rules-big').innerHTML = `${d.rules.total}<br>rules`
      g('rules-sub').textContent = `${d.rules.global} global · ${d.rules.project} project`
      g('stats-big').innerHTML = `$${d.stats.allTimeCost.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
      g('stats-sub').textContent = `${d.stats.allTimeTokens.toLocaleString()} tokens · all time`
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
      { field: 'name', headerName: 'Name' },
      { field: 'aiTitle', headerName: 'AI Title', hide: true },
      { field: 'project', headerName: 'Path' },
      { field: 'firstDisplay', headerName: 'First Message', hide: true, suppressSizeToFit: false },
      { field: 'lastDisplay', headerName: 'Last Message', suppressSizeToFit: false },
      { field: 'messages', filter: false, headerName: 'Msgs', type: 'numericColumn' },
      { field: 'duration', filter: false, headerName: 'Duration', type: 'numericColumn', valueFormatter: fmtDuration },
    ],
    data: window.api.loadSessions(),
  },
  'settings-page': {
    columnDefs: [
      { field: 'scope', headerName: 'Scope' },
      { field: 'key', headerName: 'Key' },
      { field: 'value', headerName: 'Value', suppressSizeToFit: false },
      { field: 'source', headerName: 'Source' },
    ],
    data: window.api.loadSettings(),
  },
  stats: {
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
q('[data-page]:not([data-page="home"])').forEach(nav => {
  const page = tmpl.content.cloneNode(true).firstElementChild
  page.id = nav.dataset.page
  page.querySelector(':scope > .page-header > i').className = nav.querySelector('i').className
  page.querySelector('strong').textContent = nav.querySelector('span').textContent
  g('main').appendChild(page)
})

const statsNote = document.createElement('small')
statsNote.textContent = 'All rates are per million tokens'
statsNote.style.color = 'var(--color-half)'
g('stats').querySelector('.page-header').appendChild(statsNote)

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

showPage('home')
