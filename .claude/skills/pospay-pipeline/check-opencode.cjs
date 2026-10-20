// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries exactly the required limits
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the problems listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs [path to opencode.json]
const fs = require('fs');
const path = require('path');

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
const envPaths = ['.env', '.env.*', '*/.env', '*/.env.*', `*${BS}.env`, `*${BS}.env.*`];
const claudePaths = [
  '.claude',
  '.claude/*',
  '*/.claude',
  '*/.claude/*',
  `*${BS}.claude`,
  `*${BS}.claude${BS}*`,
];
// Each path map must hold exactly these keys in this order: "*" allow first, then only denies, because the
// last matching rule wins and any later allow would re-open what the denies close.
const pathMaps = {
  read: [...gitPaths, ...envPaths, ...configPaths, ...claudePaths],
  edit: [...gitPaths, ...configPaths, ...envPaths, ...claudePaths],
  glob: gitPaths,
};
// Only read, edit (which covers write) and glob may be allowed, through the path maps above; everything named
// here must be an explicit "deny" (owner's lists, SA-6, SA-7.1 and the 2026-10-20 execute broadcast).
const mustDeny = [
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
  for (const [tool, denies] of Object.entries(pathMaps)) {
    const rules = permission[tool];
    const expected = ['*', ...denies];
    const actual = rules && typeof rules === 'object' ? Object.keys(rules) : [];
    const exact =
      actual.length === expected.length && expected.every((key, i) => actual[i] === key);
    const values = expected.every((key, i) => rules?.[key] === (i === 0 ? 'allow' : 'deny'));
    if (!exact || !values)
      problems.push(
        `${where}: ${tool} must be exactly "*": "allow" then denies on ${denies.join(', ')}`,
      );
  }
}

for (const key of Object.keys(config)) {
  if (!['$schema', 'permission', 'agent'].includes(key))
    problems.push(`top-level key "${key}" is not allowed`);
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
// plugins, custom tools, agents, modes and instruction files. The folder must hold only the AGENTS.md the dispatch
// writes, so opencode does not fall back to ~/.claude/CLAUDE.md either. It must sit outside the worktree, where
// MiniMax cannot write.
const ISOLATED_AGENTS =
  'PosPay MiniMax run: follow the attached brief only. Read and edit files in this worktree only.\n';
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
  const entries = fs.existsSync(isolatedDir) ? fs.readdirSync(isolatedDir) : [];
  if (entries.join() !== 'AGENTS.md') {
    problems.push(
      `${isolatedDir} must hold only AGENTS.md (found: ${entries.join(', ') || 'nothing'})`,
    );
  } else if (fs.readFileSync(path.join(isolatedDir, 'AGENTS.md'), 'utf8') !== ISOLATED_AGENTS) {
    problems.push(`${path.join(isolatedDir, 'AGENTS.md')} is not the dispatch's fixed text`);
  }
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

// Higher-precedence sources would override this file: the system config folder and the config env vars.
// None exists on the PosPay host today, so any that appears stops the run until someone inspects it.
const systemDir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'opencode');
if (fs.existsSync(systemDir))
  problems.push(`a system opencode config exists at ${systemDir}: inspect it`);
for (const name of Object.keys(process.env)) {
  if (/^(OPENCODE_(CONFIG|PERMISSION|DB)|XDG_DATA_HOME$)/i.test(name))
    problems.push(`environment variable ${name} is set: unset it`);
}

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
