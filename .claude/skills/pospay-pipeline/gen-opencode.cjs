// Generates opencode-pospay.json, MiniMax's permission file (pipeline skill §4).
// A JSON writer, never a hand edit: opencode silently ignores an invalid file and then runs unrestricted.
// Usage: node .claude/skills/pospay-pipeline/gen-opencode.cjs [output path]
const fs = require('fs');
const path = require('path');

const BS = String.fromCharCode(92);
const out = process.argv[2] || path.join(__dirname, 'opencode-pospay.json');

const gitPaths = ['.git', '.git/*', '*/.git', '*/.git/*', `*${BS}.git`, `*${BS}.git${BS}*`];
// A config, agent or plugin file MiniMax wrote would load on its next round, and a plugin runs as code
// outside every rule here, so MiniMax may never write one.
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
// The worktree's copied .env holds database passwords (HANDOVER §3.3); MiniMax never reads or writes one.
const envPaths = ['.env', '.env.*', '*/.env', '*/.env.*', `*${BS}.env`, `*${BS}.env.*`];
const denyAfterAllow = (paths) =>
  Object.fromEntries([['*', 'allow'], ...paths.map((p) => [p, 'deny'])]);

// An allowlist: "*" is denied first, so every tool not allowed below is refused, every MCP tool included.
// MiniMax has no shell at all (Waleed, SA-7.1, 2026-10-20): it only reads and edits files in its worktree,
// and the orchestrator runs every gate and test after reviewing the diff.
const config = {
  $schema: 'https://opencode.ai/config.json',
  permission: {
    '*': 'deny',
    external_directory: 'deny',
    read: denyAfterAllow([...gitPaths, ...envPaths]),
    edit: denyAfterAllow([...gitPaths, ...configPaths, ...envPaths]),
    glob: denyAfterAllow(gitPaths),
    list: denyAfterAllow(gitPaths),
    todowrite: 'allow',
    todoread: 'allow',
    bash: 'deny',
    shell: 'deny',
    execute: 'deny',
    grep: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    task: 'deny',
    subagent: 'deny',
    skill: 'deny',
    '*mcp*': 'deny',
    '*_mcp_resource*': 'deny',
    'opencode.*': 'deny',
  },
};

fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n');
console.log(`written: ${out}`);
