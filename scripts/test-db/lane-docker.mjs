// كونتينر الـ lane: نسخة طبق الأصل من service الـ postgres بتاعة الـ dev compose، بعلامات بتحدد الـ lane
// والـ worktree اللي شغّلته. الباسوردات بتعدّي بالاسم بس (`-e NAME` من غير قيمة)، عمرها ما بتظهر في argv أو output.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { fail } from './lane-error.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const HOST = '127.0.0.1';
export const LABEL = 'pospay.test-lane';
export const WORKTREE_LABEL = 'pospay.test-worktree';
const START_LABEL = 'pospay.test-start';
const ROOT_ENV = `${ROOT}.env`;
const COMPOSE_FILE = `${ROOT}deploy/docker-compose.dev.yml`;
const READY_TIMEOUT_MS = 90_000;
// مسارات ويندوز مش حساسة لحالة الحروف، فالـ worktree الواحد لازم ياخد label واحد مهما اتكتب؛
// في أي نظام تاني /work/Lane و /work/lane اتنين worktree مختلفين.
const ROOT_PATH = resolve(ROOT).replaceAll('\\', '/');
export const WORKTREE = process.platform === 'win32' ? ROOT_PATH.toLowerCase() : ROOT_PATH;

export function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.error) fail(`docker is not available (${result.error.message})`);
  return result;
}

export function dockerOk(args, what, options = {}) {
  const result = docker(args, options);
  // stderr بتاع docker مفيهوش الباسورد: بيتبعت بالاسم بس.
  if (result.status !== 0) fail(`${what} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export const containerName = (lane) => `pospay-test-${lane}`;

// تعريف الـ service من الـ dev compose والـ environment محلول من .env. قراءة بس: config مبيلمسش أي كونتينر.
export function devPostgresService() {
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

// بس الكونتينر اللي عليه الـ label بتاعنا وبالاسم ده بالظبط: عمرنا ما بنلمس pospay-dev-* ولا أي حاجة تانية.
export function findContainer(lane) {
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
  // الكونتينر الـ paused أو الـ restarting برضه Running=true؛ اللي ينفع نستخدمه هو الشغال وبس.
  const usable = '{{and .State.Running (not .State.Paused) (not .State.Restarting)}}';
  const labels = `{{index .Config.Labels "${WORKTREE_LABEL}"}}\t{{index .Config.Labels "${START_LABEL}"}}`;
  const [running, worktree, start] = dockerOk(
    ['inspect', '--format', `${usable}\t${labels}`, id],
    'inspecting the lane container',
  ).split('\t');
  return { id, running: running === 'true', worktree: worktree ?? '', start: start ?? '' };
}

// نفس اسم الـ lane من worktree تاني بيترفض، عشان محدش يشارك الـ cluster بتاع التاني أو يمسحه.
export function assertOwned(container, lane) {
  if (container.worktree === WORKTREE) return;
  fail(
    `${containerName(lane)} belongs to worktree ${container.worktree || '(unknown)'}, not ${WORKTREE}; ` +
      'use another lane name here, or run down from that worktree',
  );
}

export function removeContainer(id, lane) {
  // --volumes بيمسح الـ volume المجهول معاه: مفيش حاجة من الـ lane بتفضل.
  dockerOk(['rm', '--force', '--volumes', id], `removing ${containerName(lane)}`);
}

export function publishedPort(id) {
  const mapping = dockerOk(['port', id, '5432/tcp'], 'reading the published port');
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(mapping);
  if (!match) fail(`container ${id} is not published on ${HOST} only (${mapping})`);
  return Number(match[1]);
}

// start: علامة خاصة بالمحاولة دي، عشان لو فشلت نمسح الكونتينر بتاعها هي بس.
export function runContainer(lane, port, service, start) {
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
      '--label',
      `${START_LABEL}=${start}`,
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

function tcpReachable(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: HOST, port }, () => {
      socket.end();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

// initdb بيشغّل server مؤقت على الـ unix socket بس، فـ pg_isready على الـ socket بيقول "جاهز" بدري.
// الـ server النهائي هو أول واحد بيسمع على TCP.
export async function waitReady(lane, port, service) {
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
