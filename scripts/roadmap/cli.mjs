import { closeSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';

import { applyUpdates } from './set-status.mjs';

// The owner's calendar day (Kuwait), not UTC, so a merge between 00:00 and 03:00 is not stamped a day behind.
const kuwaitToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const [roadmapPath, updatesPath, today = kuwaitToday()] = process.argv.slice(2);
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
const output = JSON.stringify(roadmap, null, indent) + '\n';
const descriptor = openSync(temporaryPath, 'wx');
try {
  writeSync(descriptor, output);
  closeSync(descriptor);
  renameSync(temporaryPath, roadmapPath);
} catch (error) {
  try {
    closeSync(descriptor);
  } catch {
    // already closed
  }
  rmSync(temporaryPath, { force: true });
  throw error;
}
console.log(`roadmap updated (${today})`);
