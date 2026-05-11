const { app, BrowserWindow, globalShortcut, ipcMain, Menu, MenuItem, nativeTheme, screen } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

let win
const claudeDir = path.join(os.homedir(), '.claude')
const home = os.homedir()
const tildefy = p => { const t = p.replace(home, '~'); return t.startsWith('~/Code/') ? t.slice(7) : t }
const dirToProject = d => d.replace(/-/g, '/').replace(/^\//, '~/').replace('~/Users/' + os.userInfo().username, '~')

const createWindow = () => {
  const { x: wx, y: wy, height: sh, width: sw } = screen.getPrimaryDisplay().workArea
  const h = sh >= 1024 ? 1024 : 720
  const w = sw >= 1440 ? 1440 : 1280
  win = new BrowserWindow({
    height: h,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    width: w,
    x: wx + Math.round((sw - w) / 2),
    y: wy + Math.round((sh - h) / 2),
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.on('context-menu', (_, p) => {
    const menu = new Menu()
    menu.append(new MenuItem({ click: () => win.webContents.inspectElement(p.x, p.y), label: 'Inspect Element' }))
    menu.popup()
  })
  globalShortcut.register('CommandOrControl+Option+I', () => win.webContents.toggleDevTools())
}

app.setName('Claudia')
app.dock.setIcon(path.join(__dirname, '..', 'claudia-icon.png'))
app.whenReady().then(createWindow)

ipcMain.handle('theme:set', (_, mode) => { nativeTheme.themeSource = mode })

const pricing = {
  'claude-opus-4-6': { cacheRead: 0.50, cacheWrite: 10, input: 5, output: 25 },
  'claude-opus-4-7': { cacheRead: 0.50, cacheWrite: 10, input: 5, output: 25 },
  'claude-sonnet-4-6': { cacheRead: 0.30, cacheWrite: 6, input: 3, output: 15 },
}
const modelCost = (model, u) => {
  const p = pricing[model] || Object.entries(pricing).find(([k]) => model?.startsWith(k.slice(0, -1)))?.[1] || pricing['claude-sonnet-4-6']
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadInputTokens * p.cacheRead + u.cacheCreationInputTokens * p.cacheWrite) / 1e6
}

let tokenCache = { at: 0, date: null, today: 0, allTime: 0, byModel: {}, todayCost: 0, allTimeCost: 0 }
const getTokens = () => {
  const today = new Date().toISOString().slice(0, 10)
  if (tokenCache.date === today && Date.now() - tokenCache.at < 3600000) return tokenCache
  let todayTokens = 0, allTimeTokens = 0
  const byModel = {}
  const todayByModel = {}
  const projectsDir = path.join(claudeDir, 'projects')
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, proj)
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        for (const line of fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n')) {
          if (!line.includes('"usage"')) continue
          try {
            const msg = JSON.parse(line)
            const u = msg.message?.usage
            if (!u) continue
            const t = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
            allTimeTokens += t
            const model = msg.message?.model
            if (!model || model === '<synthetic>') continue
            if (!byModel[model]) byModel[model] = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, model, outputTokens: 0 }
            byModel[model].inputTokens += u.input_tokens || 0
            byModel[model].outputTokens += u.output_tokens || 0
            byModel[model].cacheReadInputTokens += u.cache_read_input_tokens || 0
            byModel[model].cacheCreationInputTokens += u.cache_creation_input_tokens || 0
            if (msg.timestamp?.startsWith(today)) {
              todayTokens += t
              if (!todayByModel[model]) todayByModel[model] = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, outputTokens: 0 }
              todayByModel[model].inputTokens += u.input_tokens || 0
              todayByModel[model].outputTokens += u.output_tokens || 0
              todayByModel[model].cacheReadInputTokens += u.cache_read_input_tokens || 0
              todayByModel[model].cacheCreationInputTokens += u.cache_creation_input_tokens || 0
            }
          } catch {}
        }
      }
    }
  }
  for (const m of Object.values(byModel)) m.cost = modelCost(m.model, m)
  const todayCost = Object.entries(todayByModel).reduce((sum, [model, u]) => sum + modelCost(model, u), 0)
  const allTimeCost = Object.values(byModel).reduce((sum, m) => sum + m.cost, 0)
  tokenCache = { allTime: allTimeTokens, allTimeCost, at: Date.now(), byModel, date: today, today: todayTokens, todayCost }
  return tokenCache
}

ipcMain.handle('home:load', () => {
  const today = new Date().toISOString().slice(0, 10)
  const historyFile = path.join(claudeDir, 'history.jsonl')
  const projectsDir = path.join(claudeDir, 'projects')
  const statsFile = path.join(claudeDir, 'stats-cache.json')

  let todaySessions = 0, todayMessages = 0, totalSessions = 0, totalMessages = 0
  if (fs.existsSync(historyFile)) {
    const sessions = new Map()
    for (const line of fs.readFileSync(historyFile, 'utf-8').trim().split('\n')) {
      const e = JSON.parse(line)
      const key = e.sessionId || `${e.project}::${new Date(e.timestamp).toISOString().slice(0, 10)}`
      if (!sessions.has(key)) sessions.set(key, [])
      sessions.get(key).push(e.timestamp)
    }
    totalSessions = sessions.size
    for (const [, timestamps] of sessions) {
      totalMessages += timestamps.length
      if (timestamps.some(t => new Date(t).toISOString().slice(0, 10) === today)) {
        todaySessions++
        todayMessages += timestamps.filter(t => new Date(t).toISOString().slice(0, 10) === today).length
      }
    }
  }

  let memories = 0, memoryTypes = {}
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) {
      const memDir = path.join(projectsDir, proj, 'memory')
      if (!fs.existsSync(memDir)) continue
      for (const file of fs.readdirSync(memDir)) {
        if (file === 'MEMORY.md' || !file.endsWith('.md')) continue
        memories++
        const content = fs.readFileSync(path.join(memDir, file), 'utf-8')
        const type = content.match(/type:\s*(.+)/m)?.[1]?.trim() || 'other'
        memoryTypes[type] = (memoryTypes[type] || 0) + 1
      }
    }
  }

  let rules = 0, globalRules = 0, projectRules = 0
  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) { rules++; globalRules++ }
  const rulesDir = path.join(claudeDir, 'rules')
  if (fs.existsSync(rulesDir)) { const c = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).length; rules += c; globalRules += c }
  const codeDir = path.join(home, 'Code')
  if (fs.existsSync(codeDir)) {
    const walk = dir => {
      for (const name of ['CLAUDE.md', 'AGENTS.md']) { if (fs.existsSync(path.join(dir, name))) { rules++; projectRules++ } }
      const lr = path.join(dir, '.claude', 'rules')
      if (fs.existsSync(lr)) { const c = fs.readdirSync(lr).filter(f => f.endsWith('.md')).length; rules += c; projectRules += c }
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory() && d.name !== 'node_modules' && d.name !== '.git') walk(path.join(dir, d.name))
      }
    }
    walk(codeDir)
  }

  let settings = 0
  const globalSettings = path.join(claudeDir, 'settings.json')
  if (fs.existsSync(globalSettings)) {
    const d = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'))
    settings = Object.keys(d).length
  }

  const tokens = getTokens()
  return {
    memories: { feedback: memoryTypes.feedback || 0, project: memoryTypes.project || 0, total: memories },
    rules: { global: globalRules, project: projectRules, total: rules },
    sessions: { total: totalSessions, totalMessages },
    settings: { total: settings },
    stats: { allTimeCost: tokens.allTimeCost, allTimeTokens: tokens.allTime },
    today: { cost: tokens.todayCost, messages: todayMessages, sessions: todaySessions, tokens: tokens.today },
  }
})

ipcMain.handle('memories:load', () => {
  const projectsDir = path.join(claudeDir, 'projects')
  if (!fs.existsSync(projectsDir)) return []
  const memories = []
  for (const proj of fs.readdirSync(projectsDir)) {
    const memDir = path.join(projectsDir, proj, 'memory')
    if (!fs.existsSync(memDir)) continue
    for (const file of fs.readdirSync(memDir)) {
      if (file === 'MEMORY.md' || !file.endsWith('.md')) continue
      const content = fs.readFileSync(path.join(memDir, file), 'utf-8')
      const fm = content.match(/^---\n([\s\S]*?)\n---/)
      const name = fm?.[1].match(/^name:\s*(.+)/m)?.[1] || file
      const type = fm?.[1].match(/type:\s*(.+)/m)?.[1]?.trim() || ''
      const description = fm?.[1].match(/^description:\s*(.+)/m)?.[1] || ''
      memories.push({ description, name, project: dirToProject(proj), type })
    }
  }
  return memories
})

ipcMain.handle('rules:load', () => {
  const rules = []
  const globalMd = path.join(claudeDir, 'CLAUDE.md')
  if (fs.existsSync(globalMd)) rules.push({ content: fs.readFileSync(globalMd, 'utf-8'), scope: 'global', source: '~/.claude/CLAUDE.md' })
  const rulesDir = path.join(claudeDir, 'rules')
  if (fs.existsSync(rulesDir)) {
    for (const file of fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'))) {
      rules.push({ content: fs.readFileSync(path.join(rulesDir, file), 'utf-8'), scope: 'global', source: `~/.claude/rules/${file}` })
    }
  }
  const codeDir = path.join(home, 'Code')
  if (fs.existsSync(codeDir)) {
    const walk = dir => {
      for (const name of ['CLAUDE.md', 'AGENTS.md']) {
        const f = path.join(dir, name)
        if (fs.existsSync(f)) rules.push({ content: fs.readFileSync(f, 'utf-8'), scope: 'project', source: tildefy(f) })
      }
      const localRules = path.join(dir, '.claude', 'rules')
      if (fs.existsSync(localRules)) {
        for (const file of fs.readdirSync(localRules).filter(f => f.endsWith('.md'))) {
          rules.push({ content: fs.readFileSync(path.join(localRules, file), 'utf-8'), scope: 'project', source: tildefy(path.join(localRules, file)) })
        }
      }
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory() && d.name !== 'node_modules' && d.name !== '.git') walk(path.join(dir, d.name))
      }
    }
    walk(codeDir)
  }
  return rules
})

ipcMain.handle('sessions:load', () => {
  const historyFile = path.join(claudeDir, 'history.jsonl')
  if (!fs.existsSync(historyFile)) return []
  const names = {}
  const aiTitles = {}
  const projectsDir = path.join(claudeDir, 'projects')
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, proj)
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        const sid = file.replace('.jsonl', '')
        for (const line of fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n')) {
          if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue
          try {
            const d = JSON.parse(line)
            if (d.type === 'custom-title') names[sid] = d.customTitle
            else if (d.type === 'ai-title') aiTitles[sid] = d.title || d.aiTitle
          } catch {}
        }
      }
    }
  }
  const lines = fs.readFileSync(historyFile, 'utf-8').trim().split('\n')
  const sessions = new Map()
  for (const line of lines) {
    const entry = JSON.parse(line)
    const project = entry.project || '(unknown)'
    const date = new Date(entry.timestamp)
    const key = entry.sessionId || `${project}::${date.toISOString().slice(0, 10)}`
    if (sessions.has(key)) {
      const s = sessions.get(key)
      s.end = entry.timestamp
      s.lastDisplay = entry.display
      s.messages++
      s.timestamps.push(entry.timestamp)
    } else {
      const sid = entry.sessionId || key
      sessions.set(key, { aiTitle: aiTitles[sid] || '', end: entry.timestamp, firstDisplay: entry.display, lastDisplay: entry.display, messages: 1, name: names[sid] || '', project: tildefy(project), start: entry.timestamp, timestamps: [entry.timestamp] })
    }
  }
  const GAP = 30 * 60000
  for (const s of sessions.values()) {
    s.timestamps.sort((a, b) => a - b)
    let active = 0
    for (let i = 1; i < s.timestamps.length; i++) {
      const gap = s.timestamps[i] - s.timestamps[i - 1]
      if (gap < GAP) active += gap
    }
    const days = new Set(s.timestamps.map(t => new Date(t).toISOString().slice(0, 10))).size
    s.duration = Math.round(active / 60000) + days * 5
    delete s.timestamps
  }
  return [...sessions.values()].sort((a, b) => b.end - a.end)
})

ipcMain.handle('settings:load', () => {
  const settings = []
  const flatten = (obj, prefix, source, scope) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, source, scope)
      else settings.push({ key, scope, source, value: JSON.stringify(v) })
    }
  }
  const globalFile = path.join(claudeDir, 'settings.json')
  if (fs.existsSync(globalFile)) flatten(JSON.parse(fs.readFileSync(globalFile, 'utf-8')), '', '~/.claude/settings.json', 'global')
  const codeDir = path.join(home, 'Code')
  if (fs.existsSync(codeDir)) {
    for (const d of fs.readdirSync(codeDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const projSettings = path.join(codeDir, d.name, '.claude', 'settings.json')
      if (fs.existsSync(projSettings)) flatten(JSON.parse(fs.readFileSync(projSettings, 'utf-8')), '', tildefy(projSettings), 'project')
    }
  }
  return settings
})

ipcMain.handle('stats:load', () => {
  const tokens = getTokens()
  return {
    models: Object.values(tokens.byModel).map(m => {
      const p = pricing[m.model] || Object.entries(pricing).find(([k]) => m.model?.startsWith(k.slice(0, -1)))?.[1] || pricing['claude-sonnet-4-6']
      return { ...m, cacheReadRate: p.cacheRead, cacheWriteRate: p.cacheWrite, inputRate: p.input, outputRate: p.output }
    }),
  }
})
