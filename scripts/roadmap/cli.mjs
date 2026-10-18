import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import { applyUpdates } from './set-status.mjs';

const [roadmapPath, updatesPath, today = new Date().toISOString().slice(0, 10)] =
  process.argv.slice(2);
if (!roadmapPath || !updatesPath) {
  console.error('usage: node scripts/roadmap/cli.mjs <roadmap.json> <updates.json> [YYYY-MM-DD]');
  process.exit(2);
}
const source = readFileSync(roadmapPath, 'utf8');
const roadmap = applyUpdates(
  JSON.parse(source),
  JSON.parse(readFileSync(updatesPath, 'utf8')),
  today,
);
const indent = source.trimEnd().includes('\n') ? 2 : 0;
const temporaryPath = `${roadmapPath}.${process.pid}.${Date.now()}.tmp`;
try {
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(roadmap, null, indent)}
`,
    { flag: 'wx' },
  );
  renameSync(temporaryPath, roadmapPath);
} catch (error) {
  rmSync(temporaryPath, { force: true });
  throw error;
}
console.log(`roadmap updated (${today})`);
