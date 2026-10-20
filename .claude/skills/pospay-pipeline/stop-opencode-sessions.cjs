// After every MiniMax run (or a killed one), finds opencode sessions in a folder that are still working and
// interrupts them. Killing the `opencode run` CLI does not stop a session inside the shared
// `opencode serve --service`: one kept working for 14 minutes on 2026-10-20.
// Reads opencode.db read-only (session metadata only, never credentials).
// Usage: node .claude/skills/pospay-pipeline/stop-opencode-sessions.cjs <folder> [--dry-run]
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const [folder, flag] = process.argv.slice(2);
if (!folder) {
  console.error('usage: stop-opencode-sessions.cjs <folder> [--dry-run]');
  process.exit(2);
}
const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const normalise = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const root = normalise(path.resolve(folder));

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
let failed = 0;
for (const s of busy) {
  const label = `${s.id} (${s.title ?? 'untitled'}, started ${new Date(Number(s.time_created)).toISOString()})`;
  if (flag === '--dry-run') {
    console.log(`would interrupt ${label}`);
    continue;
  }
  try {
    execFileSync('opencode', ['api', 'post', `/api/session/${s.id}/interrupt`], {
      stdio: 'pipe',
      shell: true,
    });
    console.log(`interrupted ${label}`);
  } catch (error) {
    failed++;
    console.error(`could not interrupt ${label}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
