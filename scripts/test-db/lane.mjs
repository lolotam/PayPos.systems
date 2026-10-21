// A throwaway Postgres cluster per lane, so several worktrees can run the DB integration tests at once.
// Roles are cluster-wide: on one shared cluster every run waits on the `pospay:test-cluster-roles` advisory
// lock (packages/db/test/role-lock.ts). A cluster of its own gives each lane its own roles and its own lock.
//
//   node scripts/test-db/lane.mjs up <lane> [--port N]
//   node scripts/test-db/lane.mjs down <lane>
//   node scripts/test-db/lane.mjs status
//
// The container copies the dev `postgres` service exactly: image, command flags, environment and memory limit
// are read from `docker compose config` of deploy/docker-compose.dev.yml (read-only), so they cannot drift.
// Roles and grants are created by the migration bootstrap at test time, as on a fresh CI cluster.
// Passwords travel only through the docker process environment (`-e NAME` without a value), never argv or output.
// A container belongs to the worktree that started it (label pospay.test-worktree): another worktree using the
// same lane name is refused, never handed the first one's cluster. Choosing a port and binding it run under a
// lock file in the shared git directory, and a publish collision moves on to the next free port.
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ROOT_ENV = `${ROOT}.env`;
const OVERRIDE = `${ROOT}.env.test.local`;
const COMPOSE_FILE = `${ROOT}deploy/docker-compose.dev.yml`;
const LANE = /^[a-z0-9-]{1,32}$/;
const LABEL = 'pospay.test-lane';
const WORKTREE_LABEL = 'pospay.test-worktree';
const WORKTREE = resolve(ROOT).replaceAll('\\', '/').toLowerCase();
const HOST = '127.0.0.1';
const BASE_PORT = 55400;
const PORT_SCAN = 99;
const RESERVED_PORTS = new Set([5432, 6379]);
const READY_TIMEOUT_MS = 90_000;
const START_ATTEMPTS = 5;
const LOCK_WAIT_MS = 120_000;
const LOCK_STALE_MS = 180_000;
const PORT_TAKEN = /port is already allocated|address already in use|ports are not available/i;

const USAGE = [
  'usage: node scripts/test-db/lane.mjs up <lane> [--port N]',
  '       node scripts/test-db/lane.mjs down <lane>',
  '       node scripts/test-db/lane.mjs status',
].join('\n');

function fail(message) {
  console.error('lane:', message);
  process.exit(1);
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.error) fail(`docker is not available (${result.error.message})`);
  return result;
}

function dockerOk(args, what, options = {}) {
  const result = docker(args, options);
  // stderr from docker never carries the password: it is passed by name only.
  if (result.status !== 0) fail(`${what} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const containerName = (lane) => `pospay-test-${lane}`;

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

// The dev service definition with its environment resolved from .env. Read-only: `config` touches no container.
function devPostgresService() {
  if (!existsSync(ROOT_ENV))
    fail(`${ROOT_ENV} is missing — copy the main checkout's .env into this worktree`);
  const json = dockerOk(
    ['compose', '--env-file', ROOT_ENV, '-f', COMPOSE_FILE, 'config', '--format', 'json'],
    'reading deploy/docker-compose.dev.yml',
  );
  const service = JSON.parse(json).services?.postgres;
  if (!service?.image || !Array.isArray(service.command))
    fail('the dev compose file has no postgres service');
  return service;
}

// Only containers carrying our label AND exactly our name: never pospay-dev-*, never anything else.
function findContainer(lane) {
  const id = dockerOk(
    [
      'ps',
      '-a',
      '-q',
      '--filter',
      `name=^${containerName(lane)}$`,
      '--filter',
      `label=${LABEL}=${lane}`,
    ],
    'listing lane containers',
  );
  if (id === '') return undefined;
  // A paused or restarting container still reports Running=true; only a plainly running one is usable.
  const usable = '{{and .State.Running (not .State.Paused) (not .State.Restarting)}}';
  const [running, worktree] = dockerOk(
    ['inspect', '--format', `${usable}\t{{index .Config.Labels "${WORKTREE_LABEL}"}}`, id],
    'inspecting the lane container',
  ).split('\t');
  return { id, running: running === 'true', worktree: worktree ?? '' };
}

// Same lane name from another worktree: refuse, so neither shares nor removes the other's cluster.
function assertOwned(container, lane) {
  if (container.worktree === WORKTREE) return;
  fail(
    `${containerName(lane)} belongs to worktree ${container.worktree || '(unknown)'}, not ${WORKTREE}; ` +
      'use another lane name here, or run down from that worktree',
  );
}

function removeContainer(id, lane) {
  // --volumes removes the anonymous data volume with it: nothing of the lane survives.
  dockerOk(['rm', '--force', '--volumes', id], `removing ${containerName(lane)}`);
}

function publishedPort(id) {
  const mapping = dockerOk(['port', id, '5432/tcp'], 'reading the published port');
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(mapping);
  if (!match) fail(`container ${id} is not published on ${HOST} only (${mapping})`);
  return Number(match[1]);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: HOST, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

// lane-7 → 55407 when free; otherwise the first free port from 55401. `tried` holds ports a publish lost.
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

function runContainer(lane, port, service) {
  const childEnv = { ...process.env };
  const envFlags = [];
  for (const [name, value] of Object.entries(service.environment ?? {})) {
    childEnv[name] = String(value);
    envFlags.push('-e', name);
  }
  const memory = service.mem_limit ? ['--memory', String(service.mem_limit)] : [];
  return docker(
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName(lane),
      '--label',
      `${LABEL}=${lane}`,
      '--label',
      `${WORKTREE_LABEL}=${WORKTREE}`,
      '--publish',
      `${HOST}:${port}:5432`,
      ...memory,
      ...envFlags,
      service.image,
      ...service.command,
    ],
    { env: childEnv },
  );
}

function gitCommonDir() {
  const result = spawnSync(
    'git',
    ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  );
  return result.status === 0 ? result.stdout.trim() : ROOT;
}

function lockAge(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// One lock for every worktree of the repo (the git common dir is shared), held from the port probe until
// docker has bound the port. A lock left by a crashed run is taken over after LOCK_STALE_MS.
async function withStartLock(fn) {
  const lock = join(gitCommonDir(), 'pospay-test-lane.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (lockAge(lock) > LOCK_STALE_MS) rmSync(lock, { force: true });
      else if (Date.now() > deadline)
        fail(`another lane start holds ${lock}; retry, or delete it if stale`);
      else await delay(200 + Math.random() * 300);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

// A publish collision (another process took the port after the probe) moves on to the next free port.
async function startContainer(lane, requested, service) {
  const tried = new Set();
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    const port = await choosePort(lane, requested, tried);
    const result = runContainer(lane, port, service);
    if (result.status === 0) return port;
    // A failed publish can leave the container in Created state under our name.
    const leftover = findContainer(lane);
    if (leftover !== undefined && leftover.worktree === WORKTREE)
      removeContainer(leftover.id, lane);
    if (requested !== undefined || !PORT_TAKEN.test(result.stderr)) {
      fail(`starting the lane container failed: ${result.stderr.trim()}`);
    }
    console.log(`port ${port} was taken before docker bound it; trying another`);
    tried.add(port);
  }
  return fail(`no port could be bound after ${START_ATTEMPTS} attempts; pass --port`);
}

function tcpReachable(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// initdb runs a temporary server on the unix socket only, so a socket pg_isready says "ready" too early.
// The final server is the first one listening on TCP.
async function waitReady(lane, port, service) {
  const { POSTGRES_USER: user, POSTGRES_DB: db } = service.environment ?? {};
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = docker([
      'exec',
      containerName(lane),
      'pg_isready',
      '-h',
      HOST,
      '-p',
      '5432',
      '-U',
      String(user),
      '-d',
      String(db),
    ]);
    if (probe.status === 0 && (await tcpReachable(port))) return;
    await delay(500);
  }
  fail(
    `${containerName(lane)} was not ready within ${READY_TIMEOUT_MS / 1000}s — see \`docker logs ${containerName(lane)}\``,
  );
}

const MARKER = '# pospay-test-lane=';

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
  if (existing !== undefined) {
    assertOwned(existing, lane);
    if (existing.running) {
      const port = publishedPort(existing.id);
      await waitReady(lane, port, service);
      writeOverride(lane, port);
      console.log(`${containerName(lane)} already running on ${HOST}:${port}; wrote ${OVERRIDE}`);
      console.log(`port=${port}`);
      return;
    }
    // Created, exited or restarting after an interrupted Docker lifecycle: never reuse it, start fresh.
    removeContainer(existing.id, lane);
    console.log(`removed ${containerName(lane)}: it was not running`);
  }
  const port = await withStartLock(() => startContainer(lane, requestedPort, service));
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
if (command === 'up') await up(validLane(lane), parsePort(rest));
else if (command === 'down') down(validLane(lane));
else if (command === 'status') status();
else fail(USAGE);
