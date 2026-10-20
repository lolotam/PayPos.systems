// Refuses a MiniMax run unless <worktree>/opencode.json parses and carries every required limit
// (Waleed, SA-6 and SA-7.1, 2026-10-20). Exits 1 with the missing limits listed.
// Usage: node .claude/skills/pospay-pipeline/check-opencode.cjs [path to opencode.json]
const fs = require('fs');

const file = process.argv[2] || 'opencode.json';
let permission;
try {
  permission = JSON.parse(fs.readFileSync(file, 'utf8')).permission;
} catch (error) {
  console.error(`refused: ${file} does not parse (${error.message})`);
  process.exit(1);
}

const mustDeny = [
  '*',
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
const gitPaths = ['.git', '.git/*', '*/.git', '*/.git/*'];
const problems = [];

if (!permission || Object.keys(permission)[0] !== '*') problems.push('"*" must be the first rule');
for (const key of mustDeny) {
  if (permission?.[key] !== 'deny') problems.push(`${key} must be "deny"`);
}
for (const tool of ['read', 'edit', 'glob', 'list']) {
  const rules = permission?.[tool];
  if (typeof rules !== 'object' || rules === null) {
    problems.push(`${tool} must be a path map`);
    continue;
  }
  // The last matching rule wins, so a "*": "allow" after the .git denies would override them.
  if (Object.keys(rules)[0] !== '*') problems.push(`${tool}: "*" must be the first path rule`);
  for (const p of gitPaths) if (rules[p] !== 'deny') problems.push(`${tool} must deny ${p}`);
}
const allowed = Object.entries(permission ?? {})
  .filter(([, v]) => v === 'allow')
  .map(([k]) => k);
for (const key of allowed) {
  if (!['todowrite', 'todoread'].includes(key))
    problems.push(`${key} must not be allowed outright`);
}

if (problems.length) {
  console.error(`refused: ${file}\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`ok: ${file}`);
