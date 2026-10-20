// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries exactly the required limits
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the problems listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs [path to opencode.json]
const fs = require('fs');
const os = require('os');
const path = require('path');

// Kept apart from gen-opencode.cjs on purpose: the checker is the spec the generator is held to, so a
// generator bug cannot also weaken the check.
const BS = String.fromCharCode(92);
const gitPaths = ['.git', '.git/*', '*/.git', '*/.git/*', `*${BS}.git`, `*${BS}.git${BS}*`];
const configPaths = [
  'opencode.json*',
  '*/opencode.json*',
  `*${BS}opencode.json*`,
  '.opencode',
  '.opencode/*',
  '*/.opencode',
  '*/.opencode/*',
  `*${BS}.opencode`,
  `*${BS}.opencode${BS}*`,
];
const envPaths = ['.env', '.env.*', '*/.env', '*/.env.*', `*${BS}.env`, `*${BS}.env.*`];
// Each path map must hold exactly these keys in this order: "*" allow first, then only denies, because the
// last matching rule wins and any later allow would re-open what the denies close.
const pathMaps = {
  read: [...gitPaths, ...envPaths],
  edit: [...gitPaths, ...configPaths, ...envPaths],
  glob: gitPaths,
  list: gitPaths,
};
const mustDeny = [
  'bash',
  'shell',
  'execute',
  'external_directory',
  'grep',
  'webfetch',
  'websearch',
  'task',
  'subagent',
  'skill',
  '*mcp*',
  '*_mcp_resource*',
  'opencode.*',
];
const mayAllow = ['todowrite', 'todoread'];
const knownKeys = ['*', ...mustDeny, ...mayAllow, ...Object.keys(pathMaps)];

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
  for (const key of mayAllow) {
    if (![undefined, 'allow', 'deny'].includes(permission[key]))
      problems.push(`${where}: ${key} must be "allow" or "deny"`);
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

// The global config merges in; an agent of the same name there could change this one, so refuse it.
for (const name of ['opencode.json', 'opencode.jsonc']) {
  const globalPath = path.join(os.homedir(), '.config', 'opencode', name);
  if (!fs.existsSync(globalPath)) continue;
  const raw = fs.readFileSync(globalPath, 'utf8');
  if (raw.includes(`"${AGENT}"`))
    problems.push(`the global ${name} mentions "${AGENT}": inspect it`);
}

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
