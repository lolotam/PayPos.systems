import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.staging.pospay.systems';
const APP_ORIGIN = 'https://app.staging.pospay.systems';
const REQUIRED_ENV = [
  'STAGING_UI_OWNER_EMAIL',
  'STAGING_UI_OWNER_PASSWORD',
  'STAGING_UI_STAFF_PHONE',
  'STAGING_UI_STAFF_PIN',
  'STAGING_UI_COMPANY_ID',
  'STAGING_UI_BRANCH_ID',
  'SPIKE_UDID',
  'RUNNER_TEMP',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
];

export function collectCookies(headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.includes('='))
    .join('; ');
}

export function summaryLines(summary) {
  return [
    `owner sign-in: ${summary.owner}`,
    `pairing code: ${summary.pairing}`,
    `device approval: ${summary.approval}`,
    `ui test: ${summary.ui}`,
    `device revoke: ${summary.revoke}`,
  ];
}

export function matchDeviceLabel(pages, label) {
  const matches = pages.flatMap((page) => page.items).filter((item) => item.label === label);
  if (matches.length > 1) throw new Error('duplicate device label');
  return matches[0]?.id ?? null;
}

function readConfig(env) {
  const values = {};
  for (const key of REQUIRED_ENV) {
    const value = env[key];
    if (value === undefined || value === '') throw new Error('missing environment');
    values[key] = value;
  }
  return values;
}

async function request(fetchImpl, url, options = {}) {
  const signals = [AbortSignal.timeout(30_000)];
  if (options.signal !== undefined) signals.push(options.signal);
  return fetchImpl(url, { ...options, signal: AbortSignal.any(signals) });
}

async function signInOwner(fetchImpl, config, signal) {
  const response = await request(fetchImpl, `${API_BASE}/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: config.STAGING_UI_OWNER_EMAIL,
      password: config.STAGING_UI_OWNER_PASSWORD,
    }),
    signal,
  });
  if (!response.ok) throw new Error('owner sign-in failed');
  const cookie = collectCookies(response.headers);
  if (cookie === '') throw new Error('owner cookie missing');
  return cookie;
}

async function issuePairingCode(fetchImpl, config, cookie, signal) {
  const response = await request(
    fetchImpl,
    `${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices/pairing-code`,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    },
  );
  if (!response.ok) throw new Error('pairing code failed');
  const body = await response.json();
  if (typeof body.code !== 'string' || body.code === '') throw new Error('pairing code missing');
  return body.code;
}

export async function fetchPendingDevicePages(fetchImpl, config, cookie, signal) {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  do {
    if (cursor !== null && seen.has(cursor)) throw new Error('repeated device cursor');
    if (cursor !== null) seen.add(cursor);
    const url = new URL(`${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices`);
    url.searchParams.set('status', 'pending');
    url.searchParams.set('limit', '100');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await request(fetchImpl, url, {
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    });
    if (!response.ok) throw new Error('pending devices failed');
    const page = await response.json();
    if (!Array.isArray(page.items)) throw new Error('pending devices malformed');
    pages.push(page);
    cursor = typeof page.next_cursor === 'string' && page.next_cursor !== '' ? page.next_cursor : null;
  } while (cursor !== null);
  return pages;
}

async function changeDevice(fetchImpl, config, cookie, action, id, signal) {
  const response = await request(
    fetchImpl,
    `${API_BASE}/v1/branches/${config.STAGING_UI_BRANCH_ID}/devices/${id}/${action}`,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'x-company-id': config.STAGING_UI_COMPANY_ID },
      signal,
    },
  );
  if (response.status !== 204) throw new Error(`device ${action} failed`);
}

function pause(milliseconds, signal) {
  return new Promise((resolvePause, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', stop);
      resolvePause();
    };
    const timer = setTimeout(finish, milliseconds);
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      reject(new Error('polling stopped'));
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

async function pollForApproval(fetchImpl, config, cookie, label, signal, onFound) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('polling stopped');
    const pages = await fetchPendingDevicePages(fetchImpl, config, cookie, signal);
    const id = matchDeviceLabel(pages, label);
    if (id !== null) {
      if (typeof id !== 'string' || id === '') throw new Error('device id missing');
      onFound(id);
      await changeDevice(fetchImpl, config, cookie, 'approve', id, signal);
      return 'approved';
    }
    await pause(Math.min(3_000, Math.max(1, deadline - Date.now())), signal);
  }
  return 'not found';
}

export function buildUiTestEnvironment(environment, config, code, label) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith('STAGING_UI_')),
  );
  return {
    ...inherited,
    TEST_RUNNER_SPIKE_PAIRING_CODE: code,
    TEST_RUNNER_SPIKE_DEVICE_LABEL: label,
    TEST_RUNNER_SPIKE_STAFF_PHONE: config.STAGING_UI_STAFF_PHONE,
    TEST_RUNNER_SPIKE_STAFF_PIN: config.STAGING_UI_STAFF_PIN,
  };
}

async function startUiTest(config, code, label) {
  const spike = join(config.RUNNER_TEMP, 'spike');
  const privateDir = join(spike, 'private');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(privateDir, 'counter-auth-xcodebuild.log'), 'w', 0o600);
  try {
    const child = spawn('xcodebuild', [
      'test',
      '-project', join(spike, 'SpikeUITests.xcodeproj'),
      '-scheme', 'SpikeUITests',
      '-only-testing:SpikeUITests/CounterAuthUITests',
      '-destination', `id=${config.SPIKE_UDID}`,
      '-resultBundlePath', join(spike, 'CounterAuth.xcresult'),
      'CODE_SIGN_IDENTITY=-',
      'CODE_SIGNING_REQUIRED=NO',
      'DEVELOPMENT_TEAM=',
    ], {
      env: buildUiTestEnvironment(process.env, config, code, label),
      stdio: ['ignore', log.fd, log.fd],
    });
    return { child, closeLog: () => log.close() };
  } catch (error) {
    await log.close();
    throw error;
  }
}

function waitForUiTest(child) {
  return new Promise((resolveTest) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 20 * 60_000);
    const finish = (passed) => {
      clearTimeout(timer);
      resolveTest(passed && !timedOut ? 'passed' : 'failed');
    };
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
  });
}

async function runStartedTest(fetchImpl, config, cookie, code, label, runtime, summary, signal) {
  const started = await startUiTest(config, code, label);
  runtime.child = started.child;
  if (signal.aborted) started.child.kill('SIGTERM');
  const approval = pollForApproval(fetchImpl, config, cookie, label, signal, (id) => {
    runtime.deviceId = id;
  }).catch(() => 'failed');
  try {
    summary.ui = await waitForUiTest(started.child);
    summary.approval = await approval;
  } finally {
    await started.closeLog();
  }
}

async function run(config) {
  const summary = { owner: 'failed', pairing: 'failed', approval: 'failed', ui: 'failed', revoke: 'skipped' };
  const runtime = { child: null, deviceId: null };
  const controller = new AbortController();
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    controller.abort();
    runtime.child?.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let cookie = '';
  try {
    try {
      cookie = await signInOwner(fetch, config, controller.signal);
      summary.owner = 'ok';
    } catch {}
    let code = '';
    if (cookie !== '') {
      try {
        code = await issuePairingCode(fetch, config, cookie, controller.signal);
        console.log(`::add-mask::${code}`);
        summary.pairing = 'issued';
      } catch {}
    }
    if (code !== '') {
      const suffix = randomBytes(3).toString('hex');
      const label = `ci-ios-${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}-${suffix}`;
      try {
        await runStartedTest(fetch, config, cookie, code, label, runtime, summary, controller.signal);
      } catch {}
    }
  } finally {
    if (cookie !== '' && runtime.deviceId !== null) {
      try {
        await changeDevice(fetch, config, cookie, 'revoke', runtime.deviceId);
        summary.revoke = 'done';
      } catch {
        summary.revoke = 'failed';
      }
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    for (const line of summaryLines(summary)) console.log(line);
  }
  return !interrupted && summary.ui === 'passed' && summary.revoke === 'done' ? 0 : 1;
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  let config;
  try {
    config = readConfig(process.env);
  } catch {
    console.log('counter auth: missing environment');
    process.exitCode = 1;
  }
  if (config !== undefined) {
    try {
      process.exitCode = await run(config);
    } catch {
      process.exitCode = 1;
    }
  }
}
