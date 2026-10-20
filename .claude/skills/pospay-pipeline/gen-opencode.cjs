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
// The tracked .env.example templates hold no secret, and CLAUDE.md §8 has a slice that adds an env var update one,
// so they are allowed again right after the env denies. The git, config and .claude denies come later and win.
const envExamplePaths = ['.env.example', '*/.env.example', `*${BS}.env.example`, '*.env.example'];
// The guard scripts, this template and the skills live under .claude; MiniMax never edits them.
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
  // The one nested .gitignore, .specify/.gitignore: Spec Kit's active-feature pointer and local extension config,
  // which its scripts read to pick the slice (Codex on #416).
  '.specify/feature.json',
  '.specify/extensions/*/local-config.yml',
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
// The last matching rule wins, so the order is the policy: env denies, the template allows, then every protected tree.
const fileRules = (protectedPaths) =>
  Object.fromEntries([
    ['*', 'allow'],
    ...envPaths.map((p) => [p, 'deny']),
    ...envExamplePaths.map((p) => [p, 'allow']),
    ...protectedPaths.map((p) => [p, 'deny']),
  ]);

// An allowlist: "*" is denied first, so every tool not allowed below is refused, every MCP tool included.
// MiniMax has no shell at all (Waleed, SA-7.1, 2026-10-20): it only reads and edits files in its worktree,
// and the orchestrator runs every gate and test after reviewing the diff.
const permission = {
  '*': 'deny',
  external_directory: 'deny',
  // MiniMax tried to read its own rules (Emlaa, 2026-10-20), so it may not read any opencode config either.
  read: fileRules([...gitPaths, ...configPaths, ...claudePaths, ...otherDrivePaths]),
  edit: fileRules([
    ...gitPaths,
    ...configPaths,
    ...claudePaths,
    ...generatedPaths,
    ...otherDrivePaths,
  ]),
  // opencode checks the glob permission against the pattern only, never the search root, so no path rule could keep
  // a glob out of .git, another drive or a share (Codex on #416). Briefs name every file, so MiniMax needs no glob.
  glob: 'deny',
  // Already refused by "*", each named so the owner's lists can be checked line by line. Only read and edit
  // (which covers write) are allowed.
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
