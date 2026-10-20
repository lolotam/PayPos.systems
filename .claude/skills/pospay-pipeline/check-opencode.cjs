// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries exactly the required limits
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the problems listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs [path to opencode.json]
const fs = require('fs');

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

const file = process.argv[2] || 'opencode.json';
let config;
try {
  config = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`refused: ${file} does not parse (${error.message})`);
  process.exit(1);
}

const problems = [];
const permission = config.permission ?? {};
for (const key of Object.keys(config)) {
  if (!['$schema', 'permission'].includes(key))
    problems.push(`top-level key "${key}" is not allowed`);
}
if (Object.keys(permission)[0] !== '*' || permission['*'] !== 'deny')
  problems.push('"*": "deny" must be the first rule');
for (const key of Object.keys(permission)) {
  if (!knownKeys.includes(key)) problems.push(`unknown permission key "${key}"`);
}
for (const key of mustDeny) {
  if (permission[key] !== 'deny') problems.push(`${key} must be "deny"`);
}
for (const key of mayAllow) {
  if (![undefined, 'allow', 'deny'].includes(permission[key]))
    problems.push(`${key} must be "allow" or "deny"`);
}
for (const [tool, denies] of Object.entries(pathMaps)) {
  const rules = permission[tool];
  const expected = ['*', ...denies];
  const actual = rules && typeof rules === 'object' ? Object.keys(rules) : [];
  const exact = actual.length === expected.length && expected.every((key, i) => actual[i] === key);
  const values = expected.every((key, i) => rules?.[key] === (i === 0 ? 'allow' : 'deny'));
  if (!exact || !values)
    problems.push(`${tool} must be exactly "*": "allow" then denies on ${denies.join(', ')}`);
}

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
