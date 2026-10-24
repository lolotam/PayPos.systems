// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries exactly the required limits
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the problems listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs <path to opencode.json> <opencode.exe the run will use>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');

// Kept apart from gen-opencode.cjs on purpose: the checker is the spec the generator is held to, so a
// generator bug cannot also weaken the check.
const BS = String.fromCharCode(92);
const gitPaths = ['.git', '.git/*', '*/.git', '*/.git/*', `*${BS}.git`, `*${BS}.git${BS}*`];
const configPaths = [
  'opencode.*',
  '*/opencode.*',
  `*${BS}opencode.*`,
  '.opencode',
  '.opencode/*',
  '*/.opencode',
  '*/.opencode/*',
  `*${BS}.opencode`,
  `*${BS}.opencode${BS}*`,
];
// Every secret env file form the root .gitignore ignores: .env, .env.*, and any *.env such as production.env
// (Codex on #416). Matching is case-insensitive on Windows, so .ENV is covered too (smoke-tested 2026-10-20).
const envPaths = [
  '.env',
  '.env.*',
  '*/.env',
  '*/.env.*',
  `*${BS}.env`,
  `*${BS}.env.*`,
  '*.env',
  '*.env.*',
];
const envExamplePaths = ['.env.example', '*/.env.example', `*${BS}.env.example`, '*.env.example'];
const claudePaths = [
  '.claude',
  '.claude/*',
  '*/.claude',
  '*/.claude/*',
  `*${BS}.claude`,
  `*${BS}.claude${BS}*`,
];
// Every path the root .gitignore ignores, outside .env and .claude (denied above): installed packages, build output
// the gates run, and local tool state other agents or IDEs load (.agents skills, .vscode, .playwright-mcp). git
// status cannot show an edit to a file already there, so MiniMax may never write one (MergePilot and Codex on #416).
const ignoredFolders = [
  'node_modules',
  '.pnpm-store',
  'dist',
  'build',
  '.next',
  'out',
  '.turbo',
  'coverage',
  '.agents',
  '.vscode',
  '.idea',
  '.playwright-mcp',
];
const ignoredFiles = ['.DS_Store', 'Thumbs.db', 'next-env.d.ts'];
// Logs the root .gitignore ignores (*.log and the npm/pnpm debug logs) can hold tokens, request bodies or customer
// data, and an unchanged log never shows in git status, so MiniMax may neither read nor edit one (Codex on #416).
const logPaths = ['*.log', '*-debug.log*'];
// Local tool state may hold credentials (Playwright MCP storage-state files keep cookies and local storage; IDE
// settings can keep tokens), so MiniMax may not read these folders either (Codex on #416).
const localToolPaths = ['.agents', '.vscode', '.idea', '.playwright-mcp'].flatMap((dir) => [
  dir,
  `${dir}/*`,
  `*/${dir}`,
  `*/${dir}/*`,
  `*${BS}${dir}`,
  `*${BS}${dir}${BS}*`,
]);
const generatedPaths = [
  ...ignoredFolders.flatMap((dir) => [
    dir,
    `${dir}/*`,
    `*/${dir}`,
    `*/${dir}/*`,
    `*${BS}${dir}`,
    `*${BS}${dir}${BS}*`,
  ]),
  ...ignoredFiles.flatMap((name) => [name, `*/${name}`, `*${BS}${name}`]),
  '*.tsbuildinfo',
  ...logPaths,
  // The one nested .gitignore, .specify/.gitignore: Spec Kit's active-feature pointer and local extension config,
  // which its scripts read to pick the slice (Codex on #416).
  ...['.specify/feature.json', '.specify/extensions/*/local-config.yml'].flatMap((rel) => [
    rel,
    `*/${rel}`,
    `*${BS}${rel.split('/').join(BS)}`,
  ]),
];
// opencode 2.0.32 can treat a path on another drive as inside the project on Windows (path.relative across drives
// returns an absolute path), so external_directory alone may not stop it (Codex on #416, opencode issue 27596).
// Every worktree lives on F: (the storage rule), so every other drive is denied by name, in both letter cases.
const driveLetterPaths = 'ABCDEGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .flatMap((letter) => [`${letter}:*`, `${letter.toLowerCase()}:*`]);
// A path that starts with a slash is never inside a worktree: it is a UNC share (\\host\C$), a Windows namespace
// path (\\?\C:), or a root on the current drive. Codex on #416 flagged the first two as able to skip a drive-letter deny.
// A colon anywhere but the drive letter is an NTFS stream: .env::$DATA is the .env file itself, and a named stream
// is a hidden file git never shows. No worktree path has one, so '??*:*' (two or more characters before a colon)
// refuses them while an F:\ path, whose only colon is its second character, matches nothing (Codex on #416; a smoke test read .env::$DATA before this).
// A name component that ends in a space or a dot is not a real worktree path either: opencode 2.0.32 writes it
// literally (a folder named '.opencode ' beside the real one), and Win32 tools would strip the space or dot and
// reach the protected name (Codex on #416). Normal paths never end a component that way.
const trailingAliasPaths = ['* ', '* /*', '*.', '*./*'];
const otherDrivePaths = [...driveLetterPaths, `${BS}*`, '/*', '??*:*', ...trailingAliasPaths];
// The tracked Spec Kit skills stay readable and editable through the .agents deny: only the root SKILL.md form.
const trackedAgentSkillPaths = ['.agents/skills/speckit-*/SKILL.md'];
// Each path map must hold exactly these rules in this order, because the last matching rule wins. The only allows
// after "*" are the secret-free .env.example templates, followed by the protected denies, and the tracked Spec Kit
// skills, followed by the other-drive, stream and trailing-alias denies, so no allow can reopen what follows it.
const ordered = (...groups) => groups.flatMap(([paths, action]) => paths.map((p) => [p, action]));
const fileRules = (protectedPaths) =>
  ordered(
    [['*'], 'allow'],
    [envPaths, 'deny'],
    [envExamplePaths, 'allow'],
    [protectedPaths, 'deny'],
    [trackedAgentSkillPaths, 'allow'],
    [otherDrivePaths, 'deny'],
  );
const pathMaps = {
  read: fileRules([...gitPaths, ...configPaths, ...claudePaths, ...localToolPaths, ...logPaths]),
  edit: fileRules([...gitPaths, ...configPaths, ...claudePaths, ...generatedPaths]),
};
// Only read and edit (which covers write) may be allowed, through the path maps above; everything named here must
// be an explicit "deny" (owner's lists, SA-6, SA-7.1 and the 2026-10-20 execute broadcast). glob is denied because
// opencode checks it against the pattern only, never the search root (Codex on #416).
const mustDeny = [
  'glob',
  'list',
  'todowrite',
  'todoread',
  'bash',
  'shell',
  'execute',
  'external_directory',
  'grep',
  'search',
  'fetch',
  'webfetch',
  'websearch',
  'question',
  'task',
  'subagent',
  'skill',
  '*mcp*',
  '*_mcp_resource*',
  'opencode.*',
];
const knownKeys = ['*', ...mustDeny, ...Object.keys(pathMaps)];

const AGENT = 'pospay-minimax';
const file = process.argv[2] || 'opencode.json';
let config;
try {
  config = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`refused: ${file} does not parse (${error.message})`);
  process.exit(1);
}

const problems = [];

function checkPermissionMap(permission, where) {
  if (!permission || typeof permission !== 'object') {
    problems.push(`${where} is missing`);
    return;
  }
  if (Object.keys(permission)[0] !== '*' || permission['*'] !== 'deny')
    problems.push(`${where}: "*": "deny" must be the first rule`);
  for (const key of Object.keys(permission)) {
    if (!knownKeys.includes(key)) problems.push(`${where}: unknown permission key "${key}"`);
  }
  for (const key of mustDeny) {
    if (permission[key] !== 'deny') problems.push(`${where}: ${key} must be "deny"`);
  }
  for (const [tool, expected] of Object.entries(pathMaps)) {
    const rules = permission[tool];
    const actual = rules && typeof rules === 'object' ? Object.entries(rules) : [];
    const exact =
      actual.length === expected.length &&
      expected.every(([key, action], i) => actual[i][0] === key && actual[i][1] === action);
    if (!exact)
      problems.push(
        `${where}: ${tool} must be exactly ${expected.map(([key, action]) => `"${key}": "${action}"`).join(', ')}`,
      );
  }
}

for (const key of Object.keys(config)) {
  if (!['$schema', 'formatter', 'lsp', 'permission', 'agent'].includes(key))
    problems.push(`top-level key "${key}" is not allowed`);
}
// Formatters and LSP servers run as host processes outside every permission rule, so both must be off.
for (const key of ['formatter', 'lsp']) {
  if (config[key] !== false) problems.push(`${key} must be false`);
}
checkPermissionMap(config.permission, 'permission');

// The dispatch runs with --agent pospay-minimax; agent permissions win over top-level ones, so the pinned
// agent must carry the same map, and nothing else may be defined.
const agents = config.agent ?? {};
if (Object.keys(agents).join() !== AGENT) problems.push(`agent must define exactly "${AGENT}"`);
const agent = agents[AGENT] ?? {};
for (const key of Object.keys(agent)) {
  if (!['description', 'mode', 'permission'].includes(key))
    problems.push(`agent key "${key}" is not allowed`);
}
if (agent.mode !== 'primary') problems.push(`agent ${AGENT} must be mode "primary"`);
checkPermissionMap(agent.permission, `agent ${AGENT} permission`);
if (JSON.stringify(agent.permission) !== JSON.stringify(config.permission))
  problems.push(`agent ${AGENT} permission must equal the top-level permission`);

// Every run uses an isolated global config home (XDG_CONFIG_HOME), so none of the user's global opencode config
// loads. That rules out MCP servers (the global config starts 28 on every run, some reaching outside services),
// plugins, custom tools, agents, modes and instruction files. The folder must hold only the two files the dispatch
// writes: AGENTS.md, so opencode does not fall back to ~/.claude/CLAUDE.md, and an opencode.json that only turns
// auto-update off. It must sit outside the worktree, where MiniMax cannot write.
const ISOLATED_FILES = {
  'AGENTS.md':
    'PosPay MiniMax run: follow the attached brief only. Read and edit files in this worktree only.\n',
  'opencode.json': '{ "autoupdate": false }\n',
};
const configHome = process.env.XDG_CONFIG_HOME;
const worktreeRoot = path.dirname(path.resolve(file)).toLowerCase();
if (!configHome) {
  problems.push('XDG_CONFIG_HOME is not set: the run must use the isolated config home');
} else if (path.resolve(configHome).toLowerCase().startsWith(worktreeRoot)) {
  problems.push(
    `XDG_CONFIG_HOME (${configHome}) is inside the worktree, where MiniMax could edit it`,
  );
} else {
  const isolatedDir = path.join(configHome, 'opencode');
  const entries = fs.existsSync(isolatedDir) ? fs.readdirSync(isolatedDir).sort() : [];
  const expected = Object.keys(ISOLATED_FILES).sort();
  if (entries.join() !== expected.join()) {
    problems.push(
      `${isolatedDir} must hold only ${expected.join(' and ')} (found: ${entries.join(', ') || 'nothing'})`,
    );
  } else {
    for (const [name, text] of Object.entries(ISOLATED_FILES)) {
      if (fs.readFileSync(path.join(isolatedDir, name), 'utf8') !== text)
        problems.push(`${path.join(isolatedDir, name)} is not the dispatch's fixed text`);
    }
  }
}

// opencode takes its project folder from the inherited PWD variable, not the process's current folder (#423), so a
// stale PWD would load another folder's opencode.json. The dispatch sets PWD to the worktree; anything else is refused.
if (!process.env.PWD || path.resolve(process.env.PWD).toLowerCase() !== worktreeRoot)
  problems.push(`PWD (${process.env.PWD || 'unset'}) must be the worktree that holds ${file}`);

// opencode authorizes the path as written and then follows a symlink or junction, so a link inside the worktree that
// points outside it would carry every read past external_directory (Codex on #416). MiniMax cannot create one (no
// shell), so any such link already there stops the run. pnpm's own links all stay inside the worktree (its store
// files are hard links, not symlinks): 2,832 of them in the main checkout on 2026-10-20, plus 5 broken ones.
// A link that stays inside the worktree can still give a protected folder an allowed name (docs/guard -> .claude;
// MergePilot on #416), so outside node_modules no link is allowed at all (none existed on 2026-10-20), and a pnpm link
// inside node_modules may not lead into a protected folder or file.
const PROTECTED_TARGET =
  /(^|[\\/])(\.git|\.claude|\.opencode|\.agents|\.vscode|\.idea|\.playwright-mcp|\.specify)([\\/]|$)|(^|[\\/])opencode\.[^\\/]*$|(^|[\\/])[^\\/]*\.env(\.[^\\/]*)?$|\.log$|-debug\.log[^\\/]*$/i;
const escapingLinks = [];
function checkLink(full, insideNodeModules) {
  if (!insideNodeModules) {
    escapingLinks.push(full);
    return;
  }
  let target;
  try {
    target = fs.realpathSync(full);
  } catch {
    // A broken link cannot be followed today; judge it by where it would point.
    try {
      target = path.resolve(path.dirname(full), fs.readlinkSync(full));
    } catch {
      target = '';
    }
  }
  const inside = target.toLowerCase().startsWith(worktreeRoot + path.sep);
  if (!inside || PROTECTED_TARGET.test(target.slice(worktreeRoot.length))) escapingLinks.push(full);
}
// A node_modules tree holds links only at its top level, under @scope folders, and in each .pnpm/<package>/node_modules;
// the real package files below them hold none, so only those levels are read (about 1.2 s on the main checkout).
function scanNodeModules(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) checkLink(full, true);
    else if (entry.isDirectory() && entry.name.startsWith('@')) scanNodeModules(full);
    else if (entry.isDirectory() && entry.name === '.pnpm') {
      for (const pkg of fs.readdirSync(full, { withFileTypes: true })) {
        if (pkg.isSymbolicLink()) checkLink(path.join(full, pkg.name), true);
        else if (pkg.isDirectory()) scanNodeModules(path.join(full, pkg.name, 'node_modules'));
      }
    }
  }
}
// Every folder the link scan visits, for the 8.3 check below.
const scannedDirs = [];
// A hard link is a second name for the same file, so a worktree file hard-linked to another worktree's .env would
// expose it through an allowed path (Codex on #416). Outside node_modules no file may have more than one name: none
// did on 2026-10-20 (3,830 files in a worktree, 18,758 in the main checkout). pnpm hard-links node_modules files to its
// store of public package code, which MiniMax may read but not edit.
const hardLinked = [];
// The root .git is the one entry the scan skips, and git status and reset trust it, so it must be the plain pointer
// a worktree gets: a regular file with one name (not a link, not a hard link) whose resolved gitdir is one folder
// directly under the PosPay main checkout's .git\worktrees, not any path that merely ends that way (Codex on #416).
const MAIN_WORKTREES = path
  .resolve('F:\\Dev\\Projects\\PosPay.systems\\main\\.git\\worktrees')
  .toLowerCase();
const worktreeDir = path.dirname(path.resolve(file));
const gitPointer = path.join(worktreeDir, '.git');
try {
  const pointer = fs.lstatSync(gitPointer);
  const gitdir = fs.readFileSync(gitPointer, 'utf8').trim();
  const target = gitdir.startsWith('gitdir: ') ? path.resolve(worktreeDir, gitdir.slice(8)) : '';
  if (!pointer.isFile() || pointer.isSymbolicLink() || pointer.nlink !== 1)
    problems.push(`${gitPointer} must be a plain file with one name, not a link`);
  else if (path.dirname(target).toLowerCase() !== MAIN_WORKTREES)
    problems.push(
      `${gitPointer} does not point into the PosPay main checkout's .git\\worktrees: ${gitdir}`,
    );
  else {
    // Another PosPay worktree's pointer would pass the line above, so the metadata folder's own gitdir backlink
    // must name this exact .git file (git's linked-worktree layout; Codex on #416).
    const backlink = path.resolve(fs.readFileSync(path.join(target, 'gitdir'), 'utf8').trim());
    if (backlink.toLowerCase() !== gitPointer.toLowerCase())
      problems.push(
        `${gitPointer} borrows another worktree's metadata (its backlink is ${backlink})`,
      );
  }
} catch (error) {
  problems.push(`cannot validate ${gitPointer} (${error.message})`);
}
(function scanLinks(dir) {
  scannedDirs.push(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' && dir === worktreeDir) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) checkLink(full, false);
    else if (entry.isDirectory() && entry.name === 'node_modules') scanNodeModules(full);
    else if (entry.isDirectory()) scanLinks(full);
    else if (entry.isFile() && fs.statSync(full).nlink > 1) hardLinked.push(full);
  }
})(worktreeDir);
if (escapingLinks.length)
  problems.push(
    `links outside node_modules, or leading out of the worktree or into a protected path (remove them first): ${escapingLinks.join(', ')}`,
  );
if (hardLinked.length)
  problems.push(
    `files with more than one hard-link name (remove them first): ${hardLinked.join(', ')}`,
  );

// An NTFS 8.3 short name (GIT~1 for .git) would slip past every name rule here (Codex on #416). The PosPay F: volume
// creates none (2026-10-20: no short name in the worktree, and a new long-named folder got none), so a volume that
// starts creating them, or a short name kept on any entry the link scan visited (every folder outside node_modules
// and .git, at any depth), stops the run. `dir /x` prints the short name in a fixed column (characters 39 to 50, the
// long name from 52), blank when there is none. Any short name that differs from the long name counts, with or
// without a tilde, because one can be assigned by hand (`GIT` for .git; Codex on #416). Folders go in batches.
const ENTRY_LINE = /^\d\d\/\d\d\/\d{4}\s/;
function hasShortName(line) {
  if (!ENTRY_LINE.test(line)) return false;
  if (line.length < 53) throw new Error(`unexpected dir /x line: ${line}`);
  const short = line.slice(39, 51).trim();
  const long = line.slice(52);
  return short !== '' && short.toLowerCase() !== long.toLowerCase();
}
function shortNameLines(dirs) {
  const lines = [];
  for (let start = 0; start < dirs.length;) {
    const batch = [];
    let length = 0;
    while (start < dirs.length && (batch.length === 0 || length + dirs[start].length < 6000)) {
      length += dirs[start].length + 3;
      batch.push(dirs[start++]);
    }
    // Folder names come from the worktree, where MiniMax can create them, so cmd must never parse one as syntax
    // (`probe&pwn.cmd` would run pwn.cmd; Codex on #416). Each path is double-quoted on a command line built here,
    // which makes & ( ) ^ literal; delayed expansion is off, so ! is literal too. % still expands inside quotes, so
    // a path holding one stops the run before cmd starts. Windows forbids " in names.
    const unsafe = batch.find((dir) => dir.includes('%') || dir.includes('"'));
    if (unsafe) throw new Error(`a folder name holds % or ", which cmd would expand: ${unsafe}`);
    const command = `/d /v:off /c dir /x /a ${batch.map((dir) => `"${dir}"`).join(' ')}`;
    // By absolute path, so a cmd.exe in the current folder can never be picked instead (MergePilot on #416).
    const cmdExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    const listing = execFileSync(cmdExe, [command], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    const listed = listing.split(/\r?\n/);
    // Every listed folder prints at least its "." entry, so recognizing fewer entry lines than folders means the
    // date layout is not the expected one, and the check must stop rather than pass on lines it never read
    // (Codex on #416).
    const recognized = listed.filter((line) => ENTRY_LINE.test(line)).length;
    if (recognized < batch.length)
      throw new Error(
        `dir /x printed an unexpected layout (${recognized} entry lines for ${batch.length} folders)`,
      );
    lines.push(...listed.filter(hasShortName));
  }
  return lines;
}
try {
  if (configHome) {
    const probe = path.join(configHome, 'pospay-8dot3-probe-with-a-long-name');
    fs.mkdirSync(probe, { recursive: true });
    try {
      if (shortNameLines([configHome]).length)
        problems.push(
          'this volume creates 8.3 short names: disable them (fsutil 8dot3name set) first',
        );
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  }
  const keptShortNames = shortNameLines(scannedDirs);
  if (keptShortNames.length)
    problems.push(
      `8.3 short names in the worktree: ${keptShortNames.map((l) => l.trim()).join(' | ')}`,
    );
} catch (error) {
  problems.push(`cannot confirm that no 8.3 short name exists (${error.message})`);
}

// opencode can update itself in place (Codex on #416, upstream issue 56835), and every rule here was smoke-tested on
// one version. Auto-update is off above, and the binary the dispatch will run must be the tested one, so the version
// is read from the package beside that exact opencode.exe, not from the first one on PATH (Codex on #416). Raise
// PINNED_OPENCODE only after the skill's smoke tests pass on the new version.
const PINNED_OPENCODE = '2.1.4';
const EXE_TAIL = path.join('node_modules', '@opencode', 'cli', 'bin', 'opencode.exe').toLowerCase();
const exe = process.argv[3] ? path.resolve(process.argv[3]) : '';
const opencodePackage = path.join(path.dirname(path.dirname(exe)), 'package.json');
if (!exe || !exe.toLowerCase().endsWith(EXE_TAIL) || !fs.existsSync(exe)) {
  problems.push(
    `pass the opencode.exe the dispatch will run as the second argument (got: ${exe || 'nothing'})`,
  );
} else if (exe.toLowerCase().startsWith(worktreeRoot)) {
  problems.push(`${exe} is inside the worktree, where MiniMax could replace it`);
} else if (!fs.existsSync(opencodePackage)) {
  problems.push(`no package.json beside ${exe}`);
} else {
  const { version } = JSON.parse(fs.readFileSync(opencodePackage, 'utf8'));
  if (version !== PINNED_OPENCODE)
    problems.push(
      `opencode is ${version}, not the smoke-tested ${PINNED_OPENCODE}: rerun the smoke tests first`,
    );
}

// opencode also loads config found in every folder above the worktree, up to the drive root.
// None exists above the PosPay worktrees today, so any that appears stops the run until someone inspects it.
for (let dir = path.dirname(path.dirname(path.resolve(file))); ; dir = path.dirname(dir)) {
  for (const name of ['.opencode', 'opencode.json', 'opencode.jsonc']) {
    if (fs.existsSync(path.join(dir, name)))
      problems.push(`an ancestor opencode config exists: ${path.join(dir, name)}`);
  }
  if (path.dirname(dir) === dir) break;
}

// Higher-precedence sources would override this file: the system config folder and opencode's environment
// variables. Every OPENCODE_* variable is refused, not a list of known ones: OPENCODE_CONFIG, OPENCODE_PERMISSION
// and OPENCODE_DB change the config or database, and OPENCODE_DISABLE_PROJECT_CONFIG skips this file entirely.
// XDG_DATA_HOME moves the database too. None is set on the PosPay host today.
const systemDir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'opencode');
if (fs.existsSync(systemDir))
  problems.push(`a system opencode config exists at ${systemDir}: inspect it`);
for (const name of Object.keys(process.env)) {
  if (/^(OPENCODE_|XDG_DATA_HOME$)/i.test(name))
    problems.push(`environment variable ${name} is set: unset it`);
}

// opencode fetches a signed-in organization's config and merges it after this file (Codex on #416), so an account
// could override every rule here. The shared data store must hold no account. Its tables are read, never written.
const dataDb = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const accountTables = ['account', 'account_state', 'control_account'];
try {
  const db = new DatabaseSync(dataDb, { readOnly: true });
  try {
    for (const table of accountTables) {
      const { rows } = db.prepare(`select count(*) as rows from ${table}`).get();
      if (rows)
        problems.push(
          `${table} in ${dataDb} has ${rows} row(s): sign opencode out of every account first`,
        );
    }
  } finally {
    db.close();
  }
} catch (error) {
  problems.push(`cannot confirm that opencode has no signed-in account (${error.message})`);
}

// A "wellknown" credential in auth.json makes opencode fetch that provider's /.well-known/opencode config and merge it
// (plugins, MCP servers, instructions) whatever the tables above say (Codex on #416). Only each entry's type is read.
const authFile = path.join(path.dirname(dataDb), 'auth.json');
try {
  const wellKnown = Object.entries(JSON.parse(fs.readFileSync(authFile, 'utf8')))
    .filter(([, entry]) => entry?.type === 'wellknown')
    .map(([name]) => name);
  if (wellKnown.length)
    problems.push(
      `${authFile} has a wellknown credential (${wellKnown.join(', ')}): remove it first`,
    );
} catch (error) {
  problems.push(`cannot confirm that ${authFile} has no wellknown credential (${error.message})`);
}

// A bare opencode command without --standalone (debug config, models, auth list) starts the shared
// `opencode serve --service`, which keeps the global config and OPENCODE_* variables it started with (#635 item 3;
// three times on 2026-10-25). The dispatch runs only while no such daemon is up.
const powershellExe = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
try {
  const commandLines = execFileSync(
    powershellExe,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'opencode.exe\'" | ForEach-Object { $_.CommandLine }',
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  const services = commandLines
    .split(/\r?\n/)
    .filter((line) => /\bserve\b/i.test(line) && /--service\b/i.test(line));
  if (services.length)
    problems.push(
      `the shared opencode service is running (${services.length} process(es)): stop it before dispatch`,
    );
} catch (error) {
  problems.push(`cannot confirm that the shared opencode service is stopped (${error.message})`);
}

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
