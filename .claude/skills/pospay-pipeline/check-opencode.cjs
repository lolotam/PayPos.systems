// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries exactly the required limits
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the problems listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs <path to opencode.json> <opencode.exe the run will use>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

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
  '*.log',
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
// refuses them while F:... still matches nothing (Codex on #416; a smoke test read .env::$DATA before this).
// A name component that ends in a space or a dot is not a real worktree path either: opencode 2.0.32 writes it
// literally (a folder named '.opencode ' beside the real one), and Win32 tools would strip the space or dot and
// reach the protected name (Codex on #416). Normal paths never end a component that way.
const trailingAliasPaths = ['* ', '* /*', '*.', '*./*'];
const otherDrivePaths = [...driveLetterPaths, `${BS}*`, '/*', '??*:*', ...trailingAliasPaths];
// Each path map must hold exactly these rules in this order, because the last matching rule wins. The only allows
// after "*" are the secret-free .env.example templates, and the git, config and .claude denies follow them, so no
// allow can re-open a protected tree.
const ordered = (...groups) => groups.flatMap(([paths, action]) => paths.map((p) => [p, action]));
const fileRules = (protectedPaths) =>
  ordered(
    [['*'], 'allow'],
    [envPaths, 'deny'],
    [envExamplePaths, 'allow'],
    [protectedPaths, 'deny'],
  );
const pathMaps = {
  read: fileRules([...gitPaths, ...configPaths, ...claudePaths, ...otherDrivePaths]),
  edit: fileRules([
    ...gitPaths,
    ...configPaths,
    ...claudePaths,
    ...generatedPaths,
    ...otherDrivePaths,
  ]),
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

// opencode can update itself in place (Codex on #416, upstream issue 56835), and every rule here was smoke-tested on
// one version. Auto-update is off above, and the binary the dispatch will run must be the tested one, so the version
// is read from the package beside that exact opencode.exe, not from the first one on PATH (Codex on #416). Raise
// PINNED_OPENCODE only after the skill's smoke tests pass on the new version.
const PINNED_OPENCODE = '2.0.32';
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

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
