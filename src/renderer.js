const g = document.getElementById.bind(document)
const q = sel => document.querySelectorAll(sel)

agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule, agGrid.AllEnterpriseModule])

const gridTheme = agGrid.themeQuartz.withParams({
  backgroundColor: 'transparent',
  borderColor: 'var(--color-light)',
  foregroundColor: 'var(--color-darkest)',
  headerBackgroundColor: 'transparent',
  headerTextColor: 'var(--color-darker)',
  rowBorder: { color: 'var(--color-light)', style: 'solid', width: 1 },
  rowHoverColor: 'var(--color-lighter)',
})

const setMode = mode => {
  window.api.setTheme(mode)
  localStorage.setItem('mode', mode)
  for (const b of g('mode-select').children) b.classList.toggle('active', b.dataset.mode === mode)
}

g('mode-select').addEventListener('click', e => {
  const btn = e.target.closest('button')
  if (btn) setMode(btn.dataset.mode)
})

setMode(localStorage.getItem('mode') || 'system')

q('[data-page]').forEach(btn =>
  btn.addEventListener('click', () => {
    q('[data-page]').forEach(b => b.classList.remove('active'))
    q('.page').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    g(btn.dataset.page)?.classList.add('active')
  }),
)

g('sidebar-toggle').addEventListener('click', () => g('side').classList.toggle('collapsed'))

agGrid.createGrid(g('grid'), {
  autoSizeStrategy: { type: 'fitCellContents', scaleUpToFitGridWidth: true },
  columnDefs: [
    { field: 'name', headerName: 'Name' },
    { field: 'kind', headerName: 'Kind' },
    { field: 'size', headerName: 'Size' },
  ],
  defaultColDef: { resizable: false, sortable: true },
  rowData: [
    { kind: 'sample', name: 'Hello', size: 1 },
    { kind: 'sample', name: 'World', size: 2 },
  ],
  theme: gridTheme,
})
