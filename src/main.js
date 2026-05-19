const { app, BrowserWindow, globalShortcut, ipcMain, Menu, MenuItem, nativeImage, nativeTheme, screen, Tray } = require('electron')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

let win, tray, widget
const claudeDir = path.join(os.homedir(), '.claude')
const home = os.homedir()
const tildefy = p => { const t = p.replace(home, '~'); return t.startsWith('~/Code/') ? t.slice(7) : t }
const dirToProject = d => d.replace(/-/g, '/').replace(/^\//, '~/').replace('~/Users/' + os.userInfo().username, '~')
const stateFile = path.join(claudeDir, 'claudia.json')
const loadState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) } catch { return {} } }
const saveState = patch => { try { fs.writeFileSync(stateFile, JSON.stringify({ ...loadState(), ...patch })) } catch {} }

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

const iconPath = path.join(__dirname, '..', 'claudia-icon.png')

const createTray = () => {
  if (tray) return
  const empty = nativeImage.createEmpty()
  tray = new Tray(empty)
  tray.setToolTip('Claudia')
  tray.setContextMenu(Menu.buildFromTemplate([
    { click: () => { win?.show(); win?.focus() }, label: 'Open Claudia' },
    { click: () => app.quit(), label: 'Quit' },
  ]))
  let idx = 0
  const relativeReset = str => {
    if (!str) return null
    const now = new Date()
    let target
    const timeMatch = str.match(/^(\d+):?(\d*)([ap]m)/)
    const dateMatch = str.match(/(\w+)\s+(\d+)\s+at\s+(\d+):?(\d*)([ap]m)/)
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
    if (!target) return null
    const diff = Math.round((target - now) / 60000)
    if (diff < 60) return `resets in ${diff}m`
    if (diff < 1440) return `resets in ${Math.round(diff / 60)}h`
    return `resets in ${Math.round(diff / 1440)}d`
  }
  const cycle = () => {
    const tokens = getTokens()
    const plan = planCache
    const stats = [
      plan?.session.pct != null ? `${plan.session.pct}% session` : null,
      relativeReset(plan?.session.resets),
      `${tokens.todayTurns || 0} turns`,
      `${fmtCompact(tokens.today)} tokens`,
      `$${tokens.todayCost.toFixed(2)} today`,
    ].filter(Boolean)
    tray.setTitle(stats[idx % stats.length])
    idx++
  }
  cycle()
  tray._cycleInterval = setInterval(cycle, 4000)
}

const destroyTray = () => {
  if (!tray) return
  clearInterval(tray._cycleInterval)
  tray.destroy()
  tray = null
}

const fmtCompact = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

const createWidget = () => {
  if (widget) return
  const { width: sw } = screen.getPrimaryDisplay().workArea
  widget = new BrowserWindow({
    alwaysOnTop: true,
    frame: false,
    hasShadow: true,
    height: 120,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    width: 280,
    x: sw - 300,
    y: 40,
  })
  widget.loadFile(path.join(__dirname, 'widget.html'))
  widget.on('closed', () => { widget = null })
}

const destroyWidget = () => {
  if (!widget) return
  widget.close()
  widget = null
}

const loadGoodies = () => {
  const s = loadState()
  return { planRefresh: s.planRefresh || 0, tray: s.tray || false, widget: s.widget || false }
}

let planInterval
const applyGoodies = goodies => {
  goodies.tray ? createTray() : destroyTray()
  goodies.widget ? createWidget() : destroyWidget()
  clearInterval(planInterval)
  if (goodies.planRefresh > 0) {
    planInterval = setInterval(() => {
      ipcMain.emit('plan:refresh')
    }, goodies.planRefresh * 60000)
  }
}

app.setName('Claudia')
app.dock.setIcon(iconPath)
const backupHistory = () => {
  const historyFile = path.join(claudeDir, 'history.jsonl')
  if (!fs.existsSync(historyFile)) return
  const backup = path.join(claudeDir, `history-${localDate()}.jsonl.bak`)
  if (!fs.existsSync(backup)) fs.copyFileSync(historyFile, backup)
  const cutoff = Date.now() - 7 * 86400000
  for (const f of fs.readdirSync(claudeDir).filter(f => /^history-\d{4}-\d{2}-\d{2}\.jsonl\.bak$/.test(f))) {
    if (fs.statSync(path.join(claudeDir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(claudeDir, f))
  }
}

const cleanUsageSessions = () => {
  backupHistory()
  const historyFile = path.join(claudeDir, 'history.jsonl')
  if (!fs.existsSync(historyFile)) return
  const lines = fs.readFileSync(historyFile, 'utf-8').trim().split('\n')
  const bySid = {}
  for (const line of lines) {
    try {
      const d = JSON.parse(line)
      const sid = d.sessionId
      if (!sid) continue
      if (!bySid[sid]) bySid[sid] = { displays: [], lines: [] }
      bySid[sid].displays.push(d.display || '')
      bySid[sid].lines.push(line)
    } catch {}
  }
  const junkSids = new Set()
  for (const [sid, data] of Object.entries(bySid)) {
    if (data.displays.length === 1 && data.displays[0].includes('/usage')) junkSids.add(sid)
  }
  if (!junkSids.size) return
  const kept = lines.filter(line => { try { return !junkSids.has(JSON.parse(line).sessionId) } catch { return true } })
  fs.writeFileSync(historyFile, kept.join('\n') + '\n')
  const projectsDir = path.join(claudeDir, 'projects')
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) {
      for (const sid of junkSids) {
        const f = path.join(projectsDir, proj, `${sid}.jsonl`)
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }
    }
  }
}

app.on('will-quit', () => {
  if (planProc) planProc.kill()
  clearInterval(planInterval)
  destroyTray()
})
app.whenReady().then(() => {
  createWindow()
  applyGoodies(loadGoodies())
})

ipcMain.handle('theme:set', (_, mode) => { nativeTheme.themeSource = mode })
ipcMain.handle('goodies:load', () => loadGoodies())
ipcMain.handle('goodies:set', (_, goodies) => {
  saveState(goodies)
  applyGoodies(goodies)
})

let planProc
const fetchPlan = () => new Promise(resolve => {
  const claudeBin = path.join(home, '.local', 'bin', 'claude')
  const script = `set timeout 20\nspawn ${claudeBin}\nexpect "shortcuts"\nsend "/usage\\r"\nexpect "used"\nsleep 1\n`
  planProc = execFile('/usr/bin/expect', ['-c', script], { env: { ...process.env, PATH: `${path.join(home, '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin` }, timeout: 30000 }, (err, stdout) => {
    planProc = null
    if (!stdout) return resolve(null)
    const clean = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ' ').replace(/[^\x20-\x7e]/g, ' ').replace(/ +/g, ' ')
    const pcts = [...clean.matchAll(/(\d+)%\s*used/g)].map(m => parseInt(m[1]))
    const resets = [...clean.matchAll(/Rese\w*s?\s+([\w :]+(?:am|pm))/gi)].map(m => m[1].trim())
    cleanUsageSessions()
    resolve({ session: { pct: pcts[0] ?? null, resets: resets[0] || null }, week: { pct: pcts[1] ?? null, resets: resets[1] || null } })
  })
})

let planCache = loadState().planCache || null
const planReady = fetchPlan().then(p => {
  planCache = p
  saveState({ planCache: p })
  const fresh = computeHome()
  saveState({ homeCache: fresh })
  if (win) win.webContents.send('home:update', fresh)
})
ipcMain.on('plan:refresh', async () => {
  planCache = await fetchPlan()
  saveState({ planCache })
  const fresh = computeHome()
  saveState({ homeCache: fresh })
  if (win) win.webContents.send('home:update', fresh)
})

const pricing = {
  'claude-opus-4-6': { cacheRead: 0.50, cacheWrite: 10, input: 5, output: 25 },
  'claude-opus-4-7': { cacheRead: 0.50, cacheWrite: 10, input: 5, output: 25 },
  'claude-sonnet-4-6': { cacheRead: 0.30, cacheWrite: 6, input: 3, output: 15 },
}
const modelCost = (model, u) => {
  const p = pricing[model] || Object.entries(pricing).find(([k]) => model?.startsWith(k.slice(0, -1)))?.[1] || pricing['claude-sonnet-4-6']
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadInputTokens * p.cacheRead + u.cacheCreationInputTokens * p.cacheWrite) / 1e6
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const getTokens = () => {
  const today = localDate()
  let todayTokens = 0, allTimeTokens = 0, todayTurns = 0
  const byModel = {}
  const todayByModel = {}

  const processLine = line => {
    if (line.includes('"type":"user"') || line.includes('"type": "user"')) {
      try { const d = JSON.parse(line); if (d.type === 'user' && (d.timestamp || d._audit_timestamp) && localDate(new Date(d.timestamp || d._audit_timestamp)) === today) todayTurns++ } catch {}
    }
    if (!line.includes('"usage"')) return
    try {
      const msg = JSON.parse(line)
      const u = msg.message?.usage
      if (!u) return
      const t = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      allTimeTokens += t
      const model = msg.message?.model
      if (!model || model === '<synthetic>') return
      if (!byModel[model]) byModel[model] = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, model, outputTokens: 0 }
      byModel[model].inputTokens += u.input_tokens || 0
      byModel[model].outputTokens += u.output_tokens || 0
      byModel[model].cacheReadInputTokens += u.cache_read_input_tokens || 0
      byModel[model].cacheCreationInputTokens += u.cache_creation_input_tokens || 0
      const ts = msg.timestamp || msg._audit_timestamp
      if (ts && localDate(new Date(ts)) === today) {
        todayTokens += t
        if (!todayByModel[model]) todayByModel[model] = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, outputTokens: 0 }
        todayByModel[model].inputTokens += u.input_tokens || 0
        todayByModel[model].outputTokens += u.output_tokens || 0
        todayByModel[model].cacheReadInputTokens += u.cache_read_input_tokens || 0
        todayByModel[model].cacheCreationInputTokens += u.cache_creation_input_tokens || 0
      }
    } catch {}
  }

  const scanJsonl = dir => {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n')) processLine(line)
    }
  }

  const projectsDir = path.join(claudeDir, 'projects')
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) scanJsonl(path.join(projectsDir, proj))
  }

  for (const base of [desktopSessionsDir, path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')]) {
    if (!fs.existsSync(base)) continue
    for (const org of fs.readdirSync(base)) {
      const orgDir = path.join(base, org)
      if (!fs.statSync(orgDir).isDirectory()) continue
      for (const ws of fs.readdirSync(orgDir)) {
        const wsDir = path.join(orgDir, ws)
        if (!fs.statSync(wsDir).isDirectory()) continue
        for (const sess of fs.readdirSync(wsDir).filter(f => fs.statSync(path.join(wsDir, f)).isDirectory())) {
          const auditFile = path.join(wsDir, sess, 'audit.jsonl')
          if (fs.existsSync(auditFile)) {
            for (const line of fs.readFileSync(auditFile, 'utf-8').trim().split('\n')) processLine(line)
          }
        }
      }
    }
  }

  for (const m of Object.values(byModel)) m.cost = modelCost(m.model, m)
  const todayCost = Object.entries(todayByModel).reduce((sum, [model, u]) => sum + modelCost(model, u), 0)
  const allTimeCost = Object.values(byModel).reduce((sum, m) => sum + m.cost, 0)
  return { allTime: allTimeTokens, allTimeCost, byModel, today: todayTokens, todayCost, todayTurns }
}

const computeHome = () => {
  const today = localDate()
  const historyFile = path.join(claudeDir, 'history.jsonl')
  const projectsDir = path.join(claudeDir, 'projects')
  const statsFile = path.join(claudeDir, 'stats-cache.json')

  let todaySessions = new Set(), todayTurns = 0, totalSessions = new Set(), totalTurns = 0
  if (fs.existsSync(projectsDir)) {
    for (const proj of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, proj)
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        const sid = file.replace('.jsonl', '')
        let hasMessages = false
        for (const line of fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n')) {
          if (!line.includes('"type":"user"')) continue
          try {
            const d = JSON.parse(line)
            if (d.type !== 'user') continue
            hasMessages = true
            totalTurns++
            if (d.timestamp && localDate(new Date(d.timestamp)) === today) { todayTurns++; todaySessions.add(sid) }
          } catch {}
        }
        if (hasMessages) totalSessions.add(sid)
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

  let settings = 0, settingsAllow = 0, settingsDeny = 0
  const globalSettings = path.join(claudeDir, 'settings.json')
  if (fs.existsSync(globalSettings)) {
    const d = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'))
    settings = Object.keys(d).length
    settingsAllow = d.permissions?.allow?.length || 0
    settingsDeny = d.permissions?.deny?.length || 0
  }

  const tokens = getTokens()
  const toolsData = getTools()
  const toolsTotal = toolsData.reduce((sum, t) => sum + t.calls, 0)
  return {
    memories: { feedback: memoryTypes.feedback || 0, project: memoryTypes.project || 0, total: memories },
    plan: planCache,
    rules: { global: globalRules, project: projectRules, total: rules },
    sessions: { total: totalSessions.size, turns: totalTurns },
    settings: { allow: settingsAllow, deny: settingsDeny, total: settings },
    stats: { allTimeCost: tokens.allTimeCost, allTimeTokens: tokens.allTime },
    today: { cost: tokens.todayCost, sessions: todaySessions.size, tokens: tokens.today, turns: todayTurns },
    tools: { top3: toolsData.slice(0, 3).map(t => `${t.name} ${t.pct}%`).join(' · '), total: toolsTotal, unique: toolsData.length },
  }
}

ipcMain.handle('home:load', () => {
  const s = loadState()
  if (s.homeCache) {
    setTimeout(() => {
      const fresh = computeHome()
      saveState({ homeCache: fresh })
      if (win) win.webContents.send('home:update', fresh)
    }, 2000)
    return s.homeCache
  }
  const data = computeHome()
  saveState({ homeCache: data })
  return data
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

const desktopSessionsDir = path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')

ipcMain.handle('sessions:load', () => {
  const sessions = []

  const historyFile = path.join(claudeDir, 'history.jsonl')
  if (fs.existsSync(historyFile)) {
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
    const cliSessions = new Map()
    for (const line of fs.readFileSync(historyFile, 'utf-8').trim().split('\n')) {
      const entry = JSON.parse(line)
      const project = entry.project || '(unknown)'
      const date = new Date(entry.timestamp)
      const key = entry.sessionId || `${project}::${localDate(date)}`
      if (cliSessions.has(key)) {
        const s = cliSessions.get(key)
        s.end = entry.timestamp
        s.lastDisplay = entry.display
        s.turns++
        s.timestamps.push(entry.timestamp)
      } else {
        const sid = entry.sessionId || key
        cliSessions.set(key, { aiTitle: aiTitles[sid] || '', end: entry.timestamp, firstDisplay: entry.display, lastDisplay: entry.display, name: names[sid] || '', project: tildefy(project), source: 'CLI', start: entry.timestamp, timestamps: [entry.timestamp], turns: 1 })
      }
    }
    const GAP = 30 * 60000
    for (const s of cliSessions.values()) {
      s.timestamps.sort((a, b) => a - b)
      let active = 0
      for (let i = 1; i < s.timestamps.length; i++) {
        const gap = s.timestamps[i] - s.timestamps[i - 1]
        if (gap < GAP) active += gap
      }
      const days = new Set(s.timestamps.map(t => localDate(new Date(t)))).size
      s.duration = Math.round(active / 60000) + days * 5
      delete s.timestamps
    }
    for (const s of cliSessions.values()) {
      if (s.turns === 1 && s.firstDisplay?.includes('/usage')) continue
      sessions.push(s)
    }
  }

  const desktopDirs = [
    [desktopSessionsDir, () => 'Cowork'],
    [path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'), () => 'Code'],
  ]
  for (const [base, sourceFor] of desktopDirs) {
    if (!fs.existsSync(base)) continue
    for (const org of fs.readdirSync(base)) {
      const orgDir = path.join(base, org)
      if (!fs.statSync(orgDir).isDirectory()) continue
      for (const ws of fs.readdirSync(orgDir)) {
        const wsDir = path.join(orgDir, ws)
        if (!fs.statSync(wsDir).isDirectory()) continue
        for (const file of fs.readdirSync(wsDir).filter(f => f.endsWith('.json') && f.startsWith('local_'))) {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(wsDir, file), 'utf-8'))
            const sessDir = path.join(wsDir, file.replace('.json', ''))
            const auditFile = path.join(sessDir, 'audit.jsonl')
            let turns = d.completedTurns || 0, lastDisplay = ''
            if (fs.existsSync(auditFile)) {
              turns = 0
              for (const line of fs.readFileSync(auditFile, 'utf-8').trim().split('\n')) {
                if (!line.includes('"type":"user"')) continue
                try { const m = JSON.parse(line); if (m.type === 'user') { turns++; lastDisplay = typeof m.message?.content === 'string' ? m.message.content.slice(0, 200) : '' } } catch {}
              }
            }
            const dur = d.lastActivityAt && d.createdAt ? Math.round((d.lastActivityAt - d.createdAt) / 60000) : 0
            sessions.push({
              aiTitle: '',
              duration: dur,
              end: d.lastActivityAt,
              firstDisplay: d.initialMessage?.slice(0, 200) || '',
              lastDisplay,
              turns,
              model: d.model || '',
              name: d.title || d.processName || '',
              project: (d.userSelectedFolders || (d.originCwd ? [d.originCwd] : [])).map(tildefy).join(', '),
              source: sourceFor(d),
              start: d.createdAt,
            })
          } catch {}
        }
      }
    }
  }

  return sessions.sort((a, b) => b.end - a.end)
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

const getTools = () => {
  const tools = {}
  const projectsDir = path.join(claudeDir, 'projects')
  if (!fs.existsSync(projectsDir)) return []
  for (const proj of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, proj)
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n')) {
        if (!line.includes('"tool_use"')) continue
        try {
          const msg = JSON.parse(line)
          const content = msg.message?.content
          if (!Array.isArray(content)) continue
          for (const block of content) {
            if (block.type !== 'tool_use') continue
            const name = block.name || 'unknown'
            if (!tools[name]) tools[name] = { calls: 0, name }
            tools[name].calls++
          }
        } catch {}
      }
    }
  }
  const total = Object.values(tools).reduce((sum, t) => sum + t.calls, 0)
  return Object.values(tools).map(t => ({ ...t, pct: Math.round(t.calls / total * 1000) / 10 })).sort((a, b) => b.calls - a.calls)
}

ipcMain.handle('tools:load', () => getTools())

ipcMain.handle('stats:load', () => {
  const tokens = getTokens()
  return {
    models: Object.values(tokens.byModel).map(m => {
      const p = pricing[m.model] || Object.entries(pricing).find(([k]) => m.model?.startsWith(k.slice(0, -1)))?.[1] || pricing['claude-sonnet-4-6']
      return { ...m, cacheReadRate: p.cacheRead, cacheWriteRate: p.cacheWrite, inputRate: p.input, outputRate: p.output }
    }),
  }
})
