const fs = require('fs')
const os = require('os')
const path = require('path')

const claudeDir = path.join(os.homedir(), '.claude')
const projectsDir = path.join(claudeDir, 'projects')

const resolveProject = arg => {
  const dirs = fs.readdirSync(projectsDir)
  const match = dirs.find(d => d.endsWith(arg) || d.endsWith(arg.replace(/\//g, '-')))
  if (!match) { console.error(`No project found matching: ${arg}`); process.exit(1) }
  return match
}

const resolveSession = (project, sessionId) => {
  const dir = path.join(projectsDir, project)
  const sessions = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  if (sessionId) {
    const file = sessions.find(f => f.startsWith(sessionId))
    if (!file) { console.error(`No session ${sessionId} in ${project}`); process.exit(1) }
    return file
  }
  if (sessions.length !== 1) { console.error(`${sessions.length} sessions in ${project} — pass a session ID like source/id`); process.exit(1) }
  return sessions[0]
}

const [,, sourceArg, targetArg, ...flags] = process.argv
const apply = flags.includes('--apply')

if (!sourceArg || !targetArg) {
  console.log('Usage: node move-session.js <source-project/session-id> <target-project> [--apply]')
  console.log('  Moves a session from one project to another.')
  console.log('  Default is dry-run. Pass --apply to write changes.')
  process.exit(1)
}

const [sourceProjectArg, sourceSessionId] = sourceArg.split('/')
const sourceProject = resolveProject(sourceProjectArg)
const sessionFile = resolveSession(sourceProject, sourceSessionId)
const targetProject = resolveProject(targetArg)

const sourceDir = path.join(projectsDir, sourceProject)
const targetDir = path.join(projectsDir, targetProject)
const sourcePath = path.join(sourceDir, sessionFile)
const targetPath = path.join(targetDir, sessionFile)
const targetCwd = targetProject.replace(/-/g, '/').replace(/^\//, '/').replace(/^\/Users/, '/Users')
const sourceCwd = sourceProject.replace(/-/g, '/').replace(/^\//, '/').replace(/^\/Users/, '/Users')

const lines = fs.readFileSync(sourcePath, 'utf-8').trim().split('\n')
const sid = sessionFile.replace('.jsonl', '')

const historyFile = path.join(claudeDir, 'history.jsonl')
const historyLines = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf-8').trim().split('\n') : []
const historyMatches = historyLines.filter(l => l.includes(sid)).length

console.log('=== Move Plan ===')
console.log(`Session: ${sid}`)
console.log(`  Lines: ${lines.length}`)
console.log(`From: ${sourceProject}`)
console.log(`  CWD: ${sourceCwd}`)
console.log(`To: ${targetProject}`)
console.log(`  CWD: ${targetCwd}`)
console.log()
console.log('Changes:')
console.log(`  Rewrite cwd on ${lines.length} lines: ${sourceCwd} → ${targetCwd}`)
console.log(`  Move: ${sourcePath} → ${targetPath}`)
console.log(`  history.jsonl: ${historyMatches} entries to rewrite`)
console.log()

if (fs.existsSync(targetPath)) { console.error(`Target already exists: ${targetPath}`); process.exit(1) }

if (!apply) {
  console.log('Dry run complete. Pass --apply to write changes.')
  process.exit(0)
}

console.log('Applying...')
fs.copyFileSync(sourcePath, sourcePath + '.bak')
console.log(`  Backed up: ${sourcePath}.bak`)

const rewritten = lines.map(l => {
  const d = JSON.parse(l)
  if (d.cwd) d.cwd = targetCwd
  return JSON.stringify(d)
})
fs.writeFileSync(targetPath, rewritten.join('\n') + '\n')
console.log(`  Wrote: ${targetPath}`)
fs.unlinkSync(sourcePath)
console.log(`  Deleted: ${sourcePath}`)

if (historyMatches) {
  fs.copyFileSync(historyFile, historyFile.replace('.jsonl', `.${Date.now()}.jsonl.bak`))
  const updated = historyLines.map(l => {
    const e = JSON.parse(l)
    if (e.sessionId === sid) { e.project = targetCwd; return JSON.stringify(e) }
    return l
  })
  fs.writeFileSync(historyFile, updated.join('\n') + '\n')
  console.log(`  Rewrote ${historyMatches} history.jsonl entries`)
}

const subagentDir = path.join(sourceDir, sid)
if (fs.existsSync(subagentDir)) {
  fs.renameSync(subagentDir, path.join(targetDir, sid))
  console.log(`  Moved subagent directory`)
}

console.log('Done.')
