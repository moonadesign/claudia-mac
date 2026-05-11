const fs = require('fs')
const os = require('os')
const path = require('path')

const projectsDir = path.join(os.homedir(), '.claude', 'projects')
const claudeDir = path.join(os.homedir(), '.claude')

const resolveSession = arg => {
  const [project, sessionId] = arg.split('/')
  const dirs = fs.readdirSync(projectsDir)
  const match = dirs.find(d => d.endsWith(project) || d.endsWith(project.replace(/\//g, '-')))
  if (!match) { console.error(`No project found matching: ${project}`); process.exit(1) }
  const dir = path.join(projectsDir, match)
  const sessions = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  if (!sessions.length) { console.error(`No sessions in: ${match}`); process.exit(1) }
  if (sessionId) {
    const file = sessions.find(f => f.startsWith(sessionId))
    if (!file) { console.error(`No session ${sessionId} in ${match}`); process.exit(1) }
    return path.join(dir, file)
  }
  if (sessions.length > 1) { console.error(`${sessions.length} sessions in ${match} — pass a session ID like ${project}/<id>`); process.exit(1) }
  return path.join(dir, sessions[0])
}

const [,, sourceArg, targetArg, ...flags] = process.argv
const apply = flags.includes('--apply')

if (!sourceArg || !targetArg) {
  console.log('Usage: node merge-sessions.js <source-project> <target-project> [--apply]')
  console.log('  Prepends source session into target session.')
  console.log('  Projects can be short names like "organa" or paths like "Code/organa".')
  console.log('  Default is dry-run. Pass --apply to write changes.')
  process.exit(1)
}

const sourceFile = resolveSession(sourceArg)
const targetFile = resolveSession(targetArg)

const parseLines = file => fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
const sourceLines = parseLines(sourceFile)
const targetLines = parseLines(targetFile)

const targetSessionId = targetLines.find(l => l.sessionId)?.sessionId
const targetCwd = targetLines.find(l => l.cwd)?.cwd
if (!targetSessionId) { console.error('Could not find sessionId in target'); process.exit(1) }

const sourceSessionId = sourceLines.find(l => l.sessionId)?.sessionId
const sourceCwd = sourceLines.find(l => l.cwd)?.cwd
const sourceLastUuid = [...sourceLines].reverse().find(l => l.uuid)?.uuid
const targetFirstUuid = targetLines.find(l => l.uuid)

console.log('=== Merge Plan ===')
console.log(`Source: ${sourceFile}`)
console.log(`  Session: ${sourceSessionId}`)
console.log(`  CWD: ${sourceCwd}`)
console.log(`  Lines: ${sourceLines.length}`)
console.log(`Target: ${targetFile}`)
console.log(`  Session: ${targetSessionId}`)
console.log(`  CWD: ${targetCwd}`)
console.log(`  Lines: ${targetLines.length}`)
console.log()
console.log('Changes:')
console.log(`  Rewrite ${sourceLines.length} source lines:`)
console.log(`    sessionId: ${sourceSessionId} → ${targetSessionId}`)
if (sourceCwd !== targetCwd) console.log(`    cwd: ${sourceCwd} → ${targetCwd}`)
console.log(`  Connect: source last UUID ${sourceLastUuid?.slice(0, 8)}... → target first parentUuid`)
console.log(`  Target first message: ${targetFirstUuid?.uuid?.slice(0, 8)}... (parentUuid: ${targetFirstUuid?.parentUuid || 'null'} → ${sourceLastUuid?.slice(0, 8)}...)`)
console.log(`  Result: ${sourceLines.length + targetLines.length} total lines`)

const historyFile = path.join(claudeDir, 'history.jsonl')
const historyLines = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf-8').trim().split('\n') : []
const historyMatches = historyLines.filter(l => l.includes(sourceSessionId)).length
console.log(`  history.jsonl: ${historyMatches} entries to rewrite (sessionId + project)`)
console.log()

const relatedDirs = []
for (const sub of ['file-history', 'session-env', 'todos']) {
  const srcDir = path.join(claudeDir, sub, sourceSessionId || '')
  if (sourceSessionId && fs.existsSync(srcDir)) relatedDirs.push({ from: srcDir, sub })
}
if (relatedDirs.length) {
  console.log('Related directories:')
  relatedDirs.forEach(d => console.log(`  ${d.sub}/${sourceSessionId} → would need manual review`))
  console.log()
}

if (!apply) {
  console.log('Dry run complete. Pass --apply to write changes.')
  process.exit(0)
}

console.log('Applying...')
const sourceBackup = sourceFile + '.bak'
const targetBackup = targetFile.replace('.jsonl', `.${Date.now()}.jsonl.bak`)
fs.copyFileSync(sourceFile, sourceBackup)
fs.copyFileSync(targetFile, targetBackup)
console.log(`  Backed up: ${sourceBackup}`)
console.log(`  Backed up: ${targetBackup}`)

const rewritten = sourceLines.map(line => {
  if (line.sessionId) line.sessionId = targetSessionId
  if (line.cwd && targetCwd) line.cwd = targetCwd
  return line
})

let connected = false
const updatedTarget = targetLines.map(line => {
  if (!connected && line.uuid && line.parentUuid !== undefined) {
    line.parentUuid = sourceLastUuid
    connected = true
  }
  return line
})

const merged = [...rewritten, ...updatedTarget]
fs.writeFileSync(targetFile, merged.map(l => JSON.stringify(l)).join('\n') + '\n')
console.log(`  Wrote ${merged.length} lines to ${targetFile}`)
fs.unlinkSync(sourceFile)
console.log(`  Deleted: ${sourceFile}`)

if (historyMatches) {
  fs.copyFileSync(historyFile, historyFile.replace('.jsonl', `.${Date.now()}.jsonl.bak`))
  const updated = historyLines.map(l => {
    const e = JSON.parse(l)
    if (e.sessionId === sourceSessionId) { e.sessionId = targetSessionId; e.project = targetCwd; return JSON.stringify(e) }
    return l
  })
  fs.writeFileSync(historyFile, updated.join('\n') + '\n')
  console.log(`  Rewrote ${historyMatches} history.jsonl entries`)
}
console.log('Done.')
