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
// The worktree's copied .env holds database passwords (HANDOVER §3.3); MiniMax never reads or writes one.
const envPaths = ['.env', '.env.*', '*/.env', '*/.env.*', `*${BS}.env`, `*${BS}.env.*`];
// The guard scripts, this template and the skills live under .claude; MiniMax never edits them.
const claudePaths = [
  '.claude',
  '.claude/*',
  '*/.claude',
  '*/.claude/*',
  `*${BS}.claude`,
  `*${BS}.claude${BS}*`,
];
const denyAfterAllow = (paths) =>
  Object.fromEntries([['*', 'allow'], ...paths.map((p) => [p, 'deny'])]);

// An allowlist: "*" is denied first, so every tool not allowed below is refused, every MCP tool included.
// MiniMax has no shell at all (Waleed, SA-7.1, 2026-10-20): it only reads and edits files in its worktree,
// and the orchestrator runs every gate and test after reviewing the diff.
const permission = {
  '*': 'deny',
  external_directory: 'deny',
  // MiniMax tried to read its own rules (Emlaa, 2026-10-20), so it may not read any opencode config either.
  read: denyAfterAllow([...gitPaths, ...envPaths, ...configPaths, ...claudePaths]),
  edit: denyAfterAllow([...gitPaths, ...configPaths, ...envPaths, ...claudePaths]),
  glob: denyAfterAllow(gitPaths),
  // Already refused by "*", each named so the owner's lists can be checked line by line. Only read, edit
  // (which covers write) and glob are allowed.
  list: 'deny',
  todowrite: 'deny',
  todoread: 'deny',
  bash: 'deny',
  shell: 'deny',
  execute: 'deny',
  grep: 'deny',
  search: 'deny',
  fetch: 'deny',
  webfetch: 'deny',
  websearch: 'deny',
  question: 'deny',
  task: 'deny',
  subagent: 'deny',
  skill: 'deny',
  '*mcp*': 'deny',
  '*_mcp_resource*': 'deny',
  'opencode.*': 'deny',
};

// The dispatch pins this agent with --agent. Agent permissions win over top-level ones, so a default_agent or
// agent permissions added later to the global config cannot loosen this map; the top-level copy covers anything
// that runs without an agent.
// Formatters run after every edit and LSP servers start when a file opens, both as host processes outside every
// permission rule; a formatter also loads project config MiniMax could edit. The orchestrator formats and checks.
const config = {
  $schema: 'https://opencode.ai/config.json',
  formatter: false,
  lsp: false,
  permission,
  agent: {
    'pospay-minimax': {
      description: 'PosPay implementer: reads and edits files in its worktree only (SA-6, SA-7.1).',
      mode: 'primary',
      permission,
    },
  },
};

fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n');
console.log(`written: ${out}`);
