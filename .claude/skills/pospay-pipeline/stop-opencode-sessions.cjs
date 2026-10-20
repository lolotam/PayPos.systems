// After every MiniMax run (or a killed one), finds opencode sessions in a folder that are still working and
// interrupts them. Killing the `opencode run` CLI does not stop a session inside the shared
// `opencode serve --service`: one kept working for 14 minutes on 2026-10-20.
// Reads opencode.db read-only (session metadata only, never credentials).
// Run the trusted copy staged outside the worktree (pipeline skill §4), never the worktree's own copy.
// Usage: node <guard>/stop-opencode-sessions.cjs <absolute folder> [--since <epoch ms>] [--dry-run]
//   --since limits the check to sessions touched during this run, so an older, already-abandoned record does
//   not fail every later dispatch in the same worktree.
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const folder = args[0];
const dryRun = args.includes('--dry-run');
const sinceIndex = args.indexOf('--since');
const since = sinceIndex > 0 ? Number(args[sinceIndex + 1]) : 0;
if (!folder || !path.isAbsolute(folder) || Number.isNaN(since)) {
  console.error(
    'usage: stop-opencode-sessions.cjs <absolute folder> [--since <epoch ms>] [--dry-run]',
  );
  process.exit(2);
}
const normalise = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const root = normalise(folder);

// The real opencode.exe from an npm global install on PATH, never a bare `opencode` run through a shell:
// a shell would also find an opencode.cmd MiniMax could have written inside its worktree.
function opencodeExe() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    // Resolve first, so an entry such as `C:\x\..\<worktree>` cannot slip past the worktree exclusion.
    if (!dir || normalise(path.resolve(dir)).startsWith(root)) continue;
    const exe = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('opencode.exe not found under an npm global folder on PATH');
}

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
// A first round is busy while time_idle is null; a later round sets time_suspended while time_idle still holds
// the previous round's timestamp (opencode 2.0.32), so both count as working.
const BUSY_SQL =
  'select id, directory, title, time_created, time_updated from session_v2 ' +
  'where time_archived is null and (time_idle is null or time_suspended is not null)';

function busySessions() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(BUSY_SQL)
      .all()
      .filter((s) => {
        const dir = normalise(s.directory);
        return (dir === root || dir.startsWith(`${root}/`)) && Number(s.time_updated) >= since;
      });
  } finally {
    db.close();
  }
}

const busy = busySessions();
if (!busy.length) {
  console.log(`no working opencode session under ${root}`);
  process.exit(0);
}
const exe = dryRun ? null : opencodeExe();
let failed = 0;
for (const s of busy) {
  const label = `${s.id} (${s.title ?? 'untitled'}, started ${new Date(Number(s.time_created)).toISOString()})`;
  if (!exe) {
    console.log(`would interrupt ${label}`);
    continue;
  }
  let reply;
  try {
    reply = execFileSync(exe, ['api', 'post', `/api/session/${s.id}/interrupt`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });
  } catch (error) {
    failed++;
    console.error(`could not interrupt ${label}: ${error.message}`);
    continue;
  }
  // The endpoint answers 200 with {"interrupted": false} when nothing was stopped, so trust only an explicit
  // true, or a database that no longer shows the claim.
  let interrupted = false;
  try {
    interrupted = JSON.parse(reply).interrupted === true;
  } catch {
    interrupted = false;
  }
  const stillBusy = busySessions().some((other) => other.id === s.id);
  if (interrupted || !stillBusy) {
    console.log(`interrupted ${label}`);
  } else {
    failed++;
    console.error(
      `the interrupt did not clear ${label}: never continue this session (-s); the next round starts a new one (rule 8)`,
    );
  }
}
process.exit(failed ? 1 : 0);
