// After every MiniMax run (or a killed one), finds opencode sessions in a folder that are still working and
// interrupts them. Killing the `opencode run` CLI does not stop a session inside the shared
// `opencode serve --service`: one kept working for 14 minutes on 2026-10-20.
// Reads opencode.db read-only (session metadata only, never credentials).
// Run the trusted copy staged outside the worktree (pipeline skill §4), never the worktree's own copy.
// Usage: node <guard>/stop-opencode-sessions.cjs <absolute folder> --exe <opencode.exe> [--since <epoch ms>]
//        [--dry-run]
//   --exe is the exact binary the dispatch checked and ran, so cleanup never starts a different, unpinned opencode
//   (Codex on #416). --since limits the check to sessions touched during this run, so an older, already-abandoned
//   record does not fail every later dispatch in the same worktree.
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
const exeIndex = args.indexOf('--exe');
const exeArg = exeIndex > 0 ? args[exeIndex + 1] : '';
if (!folder || !path.isAbsolute(folder) || Number.isNaN(since) || (!dryRun && !exeArg)) {
  console.error(
    'usage: stop-opencode-sessions.cjs <absolute folder> --exe <opencode.exe> [--since <epoch ms>] [--dry-run]',
  );
  process.exit(2);
}
const normalise = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const root = normalise(folder);

// The checked opencode.exe by absolute path, never a bare `opencode` run through a shell: a shell would also find
// an opencode.cmd MiniMax could have written inside its worktree.
function opencodeExe() {
  const exe = path.resolve(exeArg);
  const tail = normalise(path.join('node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'));
  if (!normalise(exe).endsWith(tail) || !fs.existsSync(exe))
    throw new Error(`--exe must be the checked opencode.exe (got: ${exe})`);
  // Resolved first, so a path such as `C:\x\..\<worktree>` cannot slip past the worktree exclusion.
  if (normalise(exe).startsWith(root)) throw new Error(`${exe} is inside the worktree`);
  return exe;
}

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
// A first round is busy while time_idle is null; a later round sets time_suspended while time_idle still holds
// the previous round's timestamp (opencode 2.0.32, confirmed again on 2.1.4), so both count as working.
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

// Splits a Windows command line into arguments, honouring double quotes, so a quoted run title such as
// "serve --service" stays one argument (MergePilot on #643). On 2.1.4 the daemon's own line is
// `<path>\opencode.exe serve --service`. Kept identical in check-opencode.cjs and stop-opencode-sessions.cjs.
function isSharedServiceCommand(commandLine) {
  const args = [...commandLine.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  if (!/(^|[\\/])opencode(\.exe)?$/i.test(args[0] ?? '')) return false;
  const rest = args.slice(1);
  return rest.includes('serve') && rest.some((arg) => /^--service(=(true|1))?$/i.test(arg));
}

// A bare opencode command (any subcommand that needs a server, run without --standalone) starts the shared
// `opencode serve --service` detached, with the global config and MCP servers (2.1.4, #635 item 3). The checker
// refused the dispatch while one was up, so any found now started during the run: it is stopped and its PID logged.
// A service that cannot be listed or stopped fails the cleanup, so the env files stay stashed.
function stopSharedService() {
  const powershellExe = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  let listing;
  try {
    listing = execFileSync(
      powershellExe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // Stop makes a CIM error throw instead of printing nothing (MergePilot on #643).
        '$ErrorActionPreference = \'Stop\'; Get-CimInstance Win32_Process -Filter "Name=\'opencode.exe\'" | ForEach-Object { "$($_.ProcessId)`t$([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())`t$($_.CommandLine)" }',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    );
  } catch (error) {
    console.error(`could not list opencode processes: ${error.message}`);
    return 1;
  }
  let failures = 0;
  for (const line of listing.split(/\r?\n/)) {
    const [pid, created, commandLine = ''] = line.split('\t');
    if (!/^\d+$/.test(pid)) continue;
    // A withheld command line (an elevated or protected process) may hide the service, so it fails the cleanup.
    if (!commandLine.trim()) {
      failures++;
      console.error(
        `cannot read the command line of opencode PID ${pid}: it may be the shared service`,
      );
      continue;
    }
    if (!isSharedServiceCommand(commandLine)) continue;
    // Only a service started inside this run's window is stopped. Without --since there is no window, and an older
    // or undated one may be someone else's work: each is reported and left running, which fails the cleanup.
    if (sinceIndex < 0 || !/^\d+$/.test(created) || Number(created) < since) {
      failures++;
      console.error(
        `the shared opencode service PID ${pid} is not known to have started during this run: stop it by hand after checking whose it is`,
      );
      continue;
    }
    if (dryRun) {
      console.log(`would stop the shared opencode service, PID ${pid}`);
      continue;
    }
    // taskkill /T exits non-zero when a child of the tree is already gone, so only a PID still alive afterwards fails.
    try {
      // An absolute path, so a taskkill.exe planted in the worktree (the current folder) never runs (Codex on #643).
      const taskkillExe = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'taskkill.exe',
      );
      execFileSync(taskkillExe, ['/PID', pid, '/T', '/F'], { stdio: 'ignore', timeout: 15_000 });
    } catch {
      // checked below
    }
    // Only ESRCH proves the process is gone; EPERM or any other error means it may still be running.
    let alive = true;
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      alive = error.code !== 'ESRCH';
    }
    if (alive) {
      failures++;
      console.error(`could not stop the shared opencode service, PID ${pid}`);
    } else {
      console.error(`stopped the shared opencode service that started during the run, PID ${pid}`);
    }
  }
  return failures;
}

// Validated before the database is read, so a wrong --exe fails every run, not only one with a busy session.
const exe = dryRun ? null : opencodeExe();
const busy = busySessions();
if (!busy.length) {
  console.log(`no working opencode session under ${root}`);
  process.exit(stopSharedService() ? 1 : 0);
}
// The interrupt starts opencode, so it gets the run's isolation even when run by hand from another shell: PWD is the
// worktree (opencode takes its project folder from PWD, #423), a fresh config home holds only the dispatch's two fixed
// files, and no OPENCODE_* or XDG_DATA_HOME override passes through (MergePilot on #416).
function isolatedEnv() {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pospay-stop-'));
  fs.mkdirSync(path.join(configHome, 'opencode'));
  fs.writeFileSync(
    path.join(configHome, 'opencode', 'AGENTS.md'),
    'PosPay MiniMax run: follow the attached brief only. Read and edit files in this worktree only.\n',
  );
  fs.writeFileSync(path.join(configHome, 'opencode', 'opencode.json'), '{ "autoupdate": false }\n');
  const inherited = Object.entries(process.env).filter(
    ([name]) => !/^(OPENCODE_|XDG_DATA_HOME$|XDG_CONFIG_HOME$|PWD$)/i.test(name),
  );
  return {
    configHome,
    env: { ...Object.fromEntries(inherited), PWD: folder, XDG_CONFIG_HOME: configHome },
  };
}
const isolation = exe ? isolatedEnv() : null;
let failed = 0;
for (const s of busy) {
  const label = `${s.id} (${s.title ?? 'untitled'}, started ${new Date(Number(s.time_created)).toISOString()})`;
  if (!exe) {
    console.log(`would interrupt ${label}`);
    continue;
  }
  let reply;
  try {
    // --standalone starts a private server under the isolated environment above, instead of asking the shared background
    // service, which runs with the user's global config (Codex on #416; about 2 s). It does not revive a killed run's
    // claim either: both forms answered {"interrupted": false} for one on 2026-10-20, so the check below still decides.
    reply = execFileSync(exe, ['api', '--standalone', 'post', `/api/session/${s.id}/interrupt`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // The worktree is the one place already vetted: the dispatch refused a `.opencode` there, the checker
      // refused config in every ancestor, and its only opencode.json is the checked template. opencode searches
      // from its working directory up to the root, so an unvetted folder such as %TEMP% could inject config.
      cwd: folder,
      env: isolation.env,
      encoding: 'utf8',
      // A hung background service must not hold the dispatch's finally block; a timeout counts as failed cleanup.
      timeout: 30_000,
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
if (isolation) fs.rmSync(isolation.configHome, { recursive: true, force: true });
failed += stopSharedService();
process.exit(failed ? 1 : 0);
