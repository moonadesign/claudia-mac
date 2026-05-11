# Claudia

A macOS Electron app for browsing your local Claude Code data — sessions, memories, rules, settings, and usage stats.

## What it does

Claudia reads the `~/.claude/` directory and surfaces everything in one UI:

- **Sessions** — every conversation grouped by project and date, with message counts and duration
- **Memories** — all project-level memory files with type, name, and description
- **Rules** — global and project-level CLAUDE.md files and rules
- **Settings** — flattened key/value view of global and project settings.json files
- **Stats** — token usage by model, session totals, and activity history

## Utilities

### move-session

Moves a session from one project to another. Rewrites `cwd` on every line and updates `history.jsonl`. Use `claude -r` from the target project to verify.

```
node utils/move-session source-project/session-id target-project [--apply]
```

### merge-sessions

Prepends one session into another, connecting the `parentUuid` chain so `claude -r` shows a single continuous conversation. Rewrites `sessionId`, `cwd`, and `history.jsonl`.

```
node utils/merge-sessions source-project target-project [--apply]
```

Both default to dry-run. Backups are created before writing. History and target backups are timestamped for repeated merges.

## Goals

### Batch rename sessions

Session names require writing to two places: `custom-title` events in the session JSONL (persistent) and the `name` field in `sessions/<pid>.json` (live prompt label). `/rename` writes both. Claudia could support batch renaming by writing both when applicable.

### VS Code integration

The Claude Code VS Code extension already surfaces project-local sessions — it reads from `~/.claude/projects/<encoded-path>/` and scopes to the current workspace. `sessionsListEnabled` is an internal context key, not a user setting. The move-session utility is the missing link: move a session to the right project folder and it appears in the extension automatically.