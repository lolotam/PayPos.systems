// After every MiniMax run (or a killed one), finds opencode sessions in a folder that are still working and
// interrupts them. Killing the `opencode run` CLI does not stop a session inside the shared
// `opencode serve --service`: one kept working for 14 minutes on 2026-10-20.
// Reads opencode.db read-only (session metadata only, never credentials).
// Run the trusted copy staged outside the worktree (pipeline skill §4), never the worktree's own copy.
// Usage: node <guard>/stop-opencode-sessions.cjs <absolute folder> [--dry-run]
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [folder, flag] = process.argv.slice(2);
if (!folder || !path.isAbsolute(folder)) {
  console.error('usage: stop-opencode-sessions.cjs <absolute folder> [--dry-run]');
  process.exit(2);
}
const normalise = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const root = normalise(folder);

// The real opencode.exe from an npm global install on PATH, never a bare `opencode` run through a shell:
// a shell would also find an opencode.cmd MiniMax could have written inside its worktree.
function opencodeExe() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || normalise(dir).startsWith(root)) continue;
    const exe = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('opencode.exe not found under an npm global folder on PATH');
}

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const busy = db
  .prepare(
    'select id, directory, title, time_created from session_v2 where time_idle is null and time_archived is null',
  )
  .all()
  .filter((s) => {
    const dir = normalise(s.directory);
    return dir === root || dir.startsWith(`${root}/`);
  });
db.close();

if (!busy.length) {
  console.log(`no working opencode session under ${root}`);
  process.exit(0);
}
const exe = flag === '--dry-run' ? null : opencodeExe();
let failed = 0;
for (const s of busy) {
  const label = `${s.id} (${s.title ?? 'untitled'}, started ${new Date(Number(s.time_created)).toISOString()})`;
  if (!exe) {
    console.log(`would interrupt ${label}`);
    continue;
  }
  try {
    execFileSync(exe, ['api', 'post', `/api/session/${s.id}/interrupt`], {
      stdio: 'pipe',
      cwd: os.tmpdir(),
    });
    console.log(`interrupted ${label}`);
  } catch (error) {
    failed++;
    console.error(`could not interrupt ${label}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
