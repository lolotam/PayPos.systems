// cluster Postgres مؤقت لكل lane، عشان كذا worktree يشغّلوا اختبارات الـ DB في نفس الوقت.
// الـ roles على مستوى الـ cluster: على الـ cluster المشترك كل تشغيلة بتستنى الـ advisory lock
// `pospay:test-cluster-roles` (packages/db/test/role-lock.ts). cluster خاص بالـ lane بيديها roles و lock بتوعها.
//
//   node scripts/test-db/lane.mjs up <lane> [--port N]
//   node scripts/test-db/lane.mjs down <lane>
//   node scripts/test-db/lane.mjs status
//
// الكونتينر نسخة من service الـ postgres بتاعة deploy/docker-compose.dev.yml (lane-docker.mjs)، والـ roles
// بيعملها الـ migration bootstrap وقت الاختبارات زي cluster جديد في CI. اختيار البورت و docker run تحت
// start lock مشترك (lane-lock.mjs)، ولو الـ publish اصطدم بنجرب البورت الفاضي اللي بعده.
// القرار: ADR-0006، addendum 2026-10-21. الاستخدام: docs/runbook.md «Per-lane test Postgres».
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import {
  HOST,
  LABEL,
  ROOT,
  WORKTREE_LABEL,
  assertOwned,
  containerName,
  devPostgresService,
  dockerOk,
  findContainer,
  publishedPort,
  removeContainer,
  runContainer,
  waitReady,
} from './lane-docker.mjs';
import { LaneError, fail } from './lane-error.mjs';
import { withStartLock } from './lane-lock.mjs';

const OVERRIDE = `${ROOT}.env.test.local`;
const LANE = /^[a-z0-9-]{1,32}$/;
const BASE_PORT = 55400;
const PORT_SCAN = 99;
const RESERVED_PORTS = new Set([5432, 6379]);
const START_ATTEMPTS = 5;
const PORT_TAKEN = /port is already allocated|address already in use|ports are not available/i;
const MARKER = '# pospay-test-lane=';

const USAGE = [
  'usage: node scripts/test-db/lane.mjs up <lane> [--port N]',
  '       node scripts/test-db/lane.mjs down <lane>',
  '       node scripts/test-db/lane.mjs status',
].join('\n');

function validLane(lane) {
  if (lane === undefined || !LANE.test(lane)) fail(`lane name must match ${LANE}\n${USAGE}`);
  return lane;
}

function parsePort(args) {
  const index = args.indexOf('--port');
  if (index === -1) return undefined;
  const port = Number(args[index + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || RESERVED_PORTS.has(port)) {
    fail('--port must be an integer 1024–65535 and not the dev stack port (5432, 6379)');
  }
  return port;
}

function portIsFree(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen({ host: HOST, port, exclusive: true }, () => server.close(() => done(true)));
  });
}

// lane-7 → 55407 لو فاضي، وإلا أول بورت فاضي من 55401. tried فيها البورتات اللي الـ publish خسرها.
async function choosePort(lane, requested, tried) {
  if (requested !== undefined) {
    if (!(await portIsFree(requested))) fail(`port ${HOST}:${requested} is already in use`);
    return requested;
  }
  const usable = async (port) => !tried.has(port) && (await portIsFree(port));
  const suffix = /(\d+)$/.exec(lane);
  const preferred = suffix ? BASE_PORT + (Number(suffix[1]) % PORT_SCAN) : undefined;
  if (preferred !== undefined && preferred !== BASE_PORT && (await usable(preferred)))
    return preferred;
  for (let port = BASE_PORT + 1; port <= BASE_PORT + PORT_SCAN; port++) {
    if (await usable(port)) return port;
  }
  return fail(`no free port in ${BASE_PORT + 1}–${BASE_PORT + PORT_SCAN}; pass --port`);
}

// الـ git common dir واحد لكل الـ worktrees، فالـ lock اللي فيه واحد للكل.
function startLockPath() {
  const result = spawnSync(
    'git',
    ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  );
  return join(result.status === 0 ? result.stdout.trim() : ROOT, 'pospay-test-lane.lock.d');
}

// بيشتغل تحت الـ start lock. ممكن `up` تاني لنفس الـ lane يكون شغّلها وإحنا مستنيين.
async function startContainer(lane, requested, service) {
  const current = findContainer(lane);
  if (current !== undefined) {
    assertOwned(current, lane);
    if (current.running) return publishedPort(current.id);
    // مش شغال، ومفيش start شغال دلوقتي (كلهم ماسكين الـ lock ده): ده بواقي، نبدأ من جديد.
    removeContainer(current.id, lane);
    console.log(`removed ${containerName(lane)}: it was not running`);
  }
  const tried = new Set();
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    const port = await choosePort(lane, requested, tried);
    const start = randomUUID();
    const result = runContainer(lane, port, service, start);
    if (result.status === 0) return port;
    // الـ publish الفاشل ممكن يسيب كونتينر المحاولة دي في حالة Created؛ بنمسحه هو بس.
    const leftover = findContainer(lane);
    if (leftover !== undefined && leftover.start === start) removeContainer(leftover.id, lane);
    if (requested !== undefined || !PORT_TAKEN.test(result.stderr)) {
      fail(`starting the lane container failed: ${result.stderr.trim()}`);
    }
    console.log(`port ${port} was taken before docker bound it; trying another`);
    tried.add(port);
  }
  return fail(`no port could be bound after ${START_ATTEMPTS} attempts; pass --port`);
}

function writeOverride(lane, port) {
  writeFileSync(
    OVERRIDE,
    [
      `# Written by \`node scripts/test-db/lane.mjs up ${lane}\`; removed by \`down ${lane}\`. Git-ignored (.env.*).`,
      `${MARKER}${lane}`,
      `POSPAY_TEST_PG_HOST=${HOST}`,
      `POSPAY_TEST_PG_PORT=${port}`,
      '',
    ].join('\n'),
  );
}

function overrideLane() {
  if (!existsSync(OVERRIDE)) return undefined;
  const line = readFileSync(OVERRIDE, 'utf8')
    .split(/\r?\n/)
    .find((text) => text.startsWith(MARKER));
  return line?.slice(MARKER.length).trim();
}

async function up(lane, requestedPort) {
  const service = devPostgresService();
  const existing = findContainer(lane);
  if (existing !== undefined) assertOwned(existing, lane);
  if (existing?.running) {
    const port = publishedPort(existing.id);
    await waitReady(lane, port, service);
    writeOverride(lane, port);
    console.log(`${containerName(lane)} already running on ${HOST}:${port}; wrote ${OVERRIDE}`);
    console.log(`port=${port}`);
    return;
  }
  // أي حالة غير "شغال" بتتعالج تحت الـ lock: براه، الكونتينر الـ Created ممكن يكون `up` تاني في نص docker run.
  const port = await withStartLock(startLockPath(), () =>
    startContainer(lane, requestedPort, service),
  );
  await waitReady(lane, port, service);
  writeOverride(lane, port);
  console.log(`${containerName(lane)} ready on ${HOST}:${port}; wrote ${OVERRIDE}`);
  console.log(`port=${port}`);
}

function down(lane) {
  const existing = findContainer(lane);
  if (existing === undefined) console.log(`no container ${containerName(lane)}`);
  else {
    assertOwned(existing, lane);
    removeContainer(existing.id, lane);
    console.log(`removed ${containerName(lane)} and its data volume`);
  }
  const owner = overrideLane();
  if (owner === lane) {
    rmSync(OVERRIDE);
    console.log(`removed ${OVERRIDE}`);
  } else if (owner !== undefined) {
    console.log(`kept ${OVERRIDE}: it belongs to lane ${owner}`);
  }
}

function status() {
  const rows = dockerOk(
    [
      'ps',
      '-a',
      '--filter',
      `label=${LABEL}`,
      '--format',
      `{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Label "${WORKTREE_LABEL}"}}`,
    ],
    'listing lane containers',
  );
  console.log(rows === '' ? 'no lane containers' : rows);
  const owner = overrideLane();
  console.log(owner === undefined ? `no ${OVERRIDE}` : `${OVERRIDE} → lane ${owner}`);
}

const [command, lane, ...rest] = process.argv.slice(2);
try {
  if (command === 'up') await up(validLane(lane), parsePort(rest));
  else if (command === 'down') down(validLane(lane));
  else if (command === 'status') status();
  else fail(USAGE);
} catch (error) {
  if (!(error instanceof LaneError)) throw error;
  console.error('lane:', error.message);
  process.exitCode = 1;
}
