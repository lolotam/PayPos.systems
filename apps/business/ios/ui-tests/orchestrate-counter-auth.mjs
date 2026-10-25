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

// حدود التشغيل: الـ xcodebuild عنده 20 دقيقة، وبعد SIGTERM عنده 15 ثانية قبل SIGKILL،
// والاستطلاع بيستمر طول ما هو شغال.
const UI_TEST_LIMIT_MS = 20 * 60_000;
const KILL_GRACE_MS = 15_000;
const KILL_WAIT_TICKS = 60;
const POLL_INTERVAL_MS = 3_000;
const DEATH_WAIT_TICK_MS = 1_000;
const FINAL_SWEEP_LIMIT_MS = 60_000;
const REVOKE_ATTEMPTS = 3;
const REVOKE_GAP_MS = 2_000;
const LEFTOVER_MIN_AGE_MS = 30 * 60_000;
const DEVICE_LABEL_PREFIX = 'CI-IOS-';

export function collectCookies(headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.includes('='))
    .join('; ');
}

/** قيم الـ cookie نفسها (مش الأسماء): دي اللي بتتعمل لها mask عشان ما تظهرش في الـ log. */
export function cookieValues(cookie) {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes('='))
    .map((part) => part.slice(part.indexOf('=') + 1))
    .filter((value) => value !== '');
}

export function summaryLines(summary) {
  return [
    `owner sign-in: ${summary.owner}`,
    `pairing code: ${summary.pairing}`,
    `device approval: ${summary.approval}`,
    `ui test: ${summary.ui}`,
    `device revoke: ${summary.revoke}`,
    `owner sign-out: ${summary.signOut}`,
    `leftover sweep: ${summary.leftover}`,
  ];
}

/** المطابقة مش حساسة لحالة الحروف: iOS بيعمل auto-capitalisation لاسم الجهاز. */
export function matchDeviceLabel(pages, label) {
  const wanted = String(label).toUpperCase();
  const matches = pages
    .flatMap((page) => page.items)
    .filter((item) => String(item.label).toUpperCase() === wanted);
  if (matches.length > 1) throw new Error('duplicate device label');
  return matches[0]?.id ?? null;
}

/** أسماء الأجهزة اللي سابتها تشغيلات مقتولة: بتبدأ بـ CI-IOS- ولها أكتر من نص ساعة. */
export function leftoverDeviceIds(pages, now, prefix = DEVICE_LABEL_PREFIX) {
  const cutoff = now - LEFTOVER_MIN_AGE_MS;
  const ids = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (typeof item.label !== 'string') continue;
      if (!item.label.toUpperCase().startsWith(prefix)) continue;
      const created = Date.parse(item.created_at);
      if (!Number.isFinite(created) || created >= cutoff) continue;
      if (typeof item.id === 'string' && item.id !== '') ids.push(item.id);
    }
  }
  return ids;
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

/** الاسم لازم يبدأ بحروف كبيرة وأرقام: iOS بيكبّر أول حرف لوحده في حقل «Device name». */
export function buildDeviceLabel(config) {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `${DEVICE_LABEL_PREFIX}${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}-${suffix}`;
}

function sleepReal(milliseconds, signal) {
  return new Promise((resolveSleep, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', stop);
      resolveSleep();
    };
    const timer = setTimeout(finish, milliseconds);
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(new Error('sleep stopped'));
    };
    if (signal === undefined) return;
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

/** الـ clock والـ process والشبكة والـ log كلهم بيجوا من الـ deps عشان الاختبار يقدر يتحكم فيهم. */
export function defaultDeps() {
  return {
    fetch: (...args) => fetch(...args),
    spawn,
    log: (line) => console.log(line),
    now: () => Date.now(),
    sleep: (milliseconds, signal) => sleepReal(milliseconds, signal),
  };
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

async function signOutOwner(fetchImpl, cookie) {
  const response = await request(fetchImpl, `${API_BASE}/v1/auth/sign-out`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: APP_ORIGIN },
  });
  if (!response.ok) throw new Error('owner sign-out failed');
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

/** آخر بحث بالاسم: مرور واحد على كل الصفحات، محدود بستين ثانية. */
async function findDeviceByLabel(fetchImpl, config, cookie, label) {
  try {
    const pages = await fetchPendingDevicePages(
      fetchImpl,
      config,
      cookie,
      AbortSignal.timeout(FINAL_SWEEP_LIMIT_MS),
    );
    return matchDeviceLabel(pages, label);
  } catch {
    return null;
  }
}

/** المراجعة بتتكرر ثلاث مرات: فشل واحد في الشبكة مش معناه إن الجهاز فاضل معلق. */
async function revokeWithRetries(deps, config, cookie, id) {
  for (let attempt = 1; attempt <= REVOKE_ATTEMPTS; attempt += 1) {
    try {
      await changeDevice(deps.fetch, config, cookie, 'revoke', id);
      return 'done';
    } catch {
      if (attempt === REVOKE_ATTEMPTS) return 'failed';
      try {
        await deps.sleep(REVOKE_GAP_MS);
      } catch {}
    }
  }
  return 'failed';
}

/** تنظيف أول التشغيل: الأجهزة المعلّقة من تشغيلات مقتولة بتتشال قبل كود الاقتران الجديد. */
async function sweepLeftovers(deps, config, cookie, signal) {
  const pages = await fetchPendingDevicePages(deps.fetch, config, cookie, signal);
  const ids = leftoverDeviceIds(pages, deps.now());
  for (const id of ids) {
    try {
      await changeDevice(deps.fetch, config, cookie, 'revoke', id, signal);
    } catch {
      return 'failed';
    }
  }
  return `${ids.length} revoked`;
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

async function startUiTest(deps, config, code, label) {
  const spike = join(config.RUNNER_TEMP, 'spike');
  const privateDir = join(spike, 'private');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(privateDir, 'counter-auth-xcodebuild.log'), 'w', 0o600);
  try {
    const child = deps.spawn(
      'xcodebuild',
      [
        'test',
        '-project', join(spike, 'SpikeUITests.xcodeproj'),
        '-scheme', 'SpikeUITests',
        '-only-testing:SpikeUITests/CounterAuthUITests',
        '-destination', `id=${config.SPIKE_UDID}`,
        '-resultBundlePath', join(spike, 'CounterAuth.xcresult'),
        'CODE_SIGN_IDENTITY=-',
        'CODE_SIGNING_REQUIRED=NO',
        'DEVELOPMENT_TEAM=',
      ],
      {
        env: buildUiTestEnvironment(process.env, config, code, label),
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    return { child, closeLog: () => log.close() };
  } catch (error) {
    await log.close();
    throw error;
  }
}

function waitForChild(runtime) {
  return new Promise((resolveChild) => {
    const child = runtime.child;
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      runtime.closed = true;
      resolveChild(outcome);
    };
    runtime.forceClose = () => finish('failed');
    child.once('error', () => finish('failed'));
    child.once('close', (code) => finish(code === 0 ? 'passed' : 'failed'));
  });
}

/** القتل بيتصاعد: SIGTERM دلوقتي، وSIGKILL بعد مهلة التسامح لو الطفل مردّش. */
function escalateKill(deps, runtime) {
  const child = runtime.child;
  if (child === null || runtime.escalated || runtime.closed) return;
  runtime.escalated = true;
  child.kill('SIGTERM');
  void (async () => {
    try {
      await deps.sleep(KILL_GRACE_MS);
    } catch {}
    if (!runtime.closed) child.kill('SIGKILL');
  })();
}

/** بعد القتل بنستنى الموت بمقدار محدود، وبعدها بنعتبره ميت عشان التشغيل ما يعلقش. */
async function waitForDeath(deps, runtime) {
  for (let tick = 0; tick < KILL_WAIT_TICKS; tick += 1) {
    if (runtime.closed) return;
    try {
      await deps.sleep(DEATH_WAIT_TICK_MS);
    } catch {
      return;
    }
  }
  if (!runtime.closed) runtime.forceClose?.();
}

/**
 * الاستطلاع بيستمر طول ما الـ xcodebuild شغال، وكل جولة مستقلة: جولة فشلت بسبب شبكة
 * بتتعاود في الجولة الجاية بدل ما تخلّص التشغيل.
 */
async function supervise(deps, config, cookie, label, runtime, summary, controller) {
  const deadline = deps.now() + UI_TEST_LIMIT_MS;
  let found = false;
  while (!controller.signal.aborted && !runtime.closed) {
    if (runtime.deviceId === null) {
      try {
        const pages = await fetchPendingDevicePages(
          deps.fetch,
          config,
          cookie,
          controller.signal,
        );
        const id = matchDeviceLabel(pages, label);
        if (id !== null) {
          runtime.deviceId = id;
          found = true;
        }
      } catch {
        // جولة استطلاع فشلت: دي مش نهاية التشغيل.
      }
    }
    if (runtime.deviceId !== null && summary.approval !== 'approved') {
      try {
        await changeDevice(
          deps.fetch,
          config,
          cookie,
          'approve',
          runtime.deviceId,
          controller.signal,
        );
        summary.approval = 'approved';
      } catch {
        // الموافقة فشلت: الجولة الجاية بتجرب تاني، والجهاز يفضل متسجّل عشان يتشال في الآخر.
      }
    }
    if (deps.now() >= deadline) {
      escalateKill(deps, runtime);
      break;
    }
    try {
      await deps.sleep(POLL_INTERVAL_MS, controller.signal);
    } catch {
      break;
    }
  }
  if (summary.approval !== 'approved') summary.approval = found ? 'failed' : 'not found';
}

async function runUiTest(deps, config, cookie, code, label, runtime, summary, controller) {
  const started = await startUiTest(deps, config, code, label);
  runtime.child = started.child;
  // المستمعين بيتسجلوا قبل أي قتل: مينفعش ChildProcess يخرج ونفقد الحدث.
  const childOutcome = waitForChild(runtime);
  if (controller.signal.aborted) escalateKill(deps, runtime);
  try {
    await supervise(deps, config, cookie, label, runtime, summary, controller);
    if (!runtime.closed) await waitForDeath(deps, runtime);
    summary.ui = await childOutcome;
  } finally {
    // لو حصل خطأ قبل ما الطفل يخلص، ما بنسيبش شغلان جاري بعد انتهاء التشغيل.
    if (!runtime.closed) escalateKill(deps, runtime);
    await started.closeLog();
  }
}

export async function run(config, deps = defaultDeps()) {
  const summary = {
    owner: 'failed',
    pairing: 'failed',
    approval: 'failed',
    ui: 'failed',
    revoke: 'skipped',
    signOut: 'skipped',
    leftover: 'failed',
  };
  const runtime = { child: null, deviceId: null, closed: false, escalated: false };
  const controller = new AbortController();
  let interrupted = false;
  let cookie = '';
  let label = '';
  let revokeTask = null;

  // المراجعة بتبدأ مع القتل مش بعده: مفيش انتظار مفتوح على close قبل ما الجهاز يتشال.
  const startRevoke = () => {
    if (revokeTask !== null) return revokeTask;
    revokeTask = (async () => {
      if (runtime.deviceId === null && label !== '') {
        const found = await findDeviceByLabel(deps.fetch, config, cookie, label);
        if (found !== null) runtime.deviceId = found;
      }
      if (runtime.deviceId === null) {
        summary.revoke = 'skipped';
        return;
      }
      summary.revoke = await revokeWithRetries(deps, config, cookie, runtime.deviceId);
    })();
    return revokeTask;
  };

  const stop = () => {
    if (interrupted) return;
    interrupted = true;
    controller.abort();
    void startRevoke();
    escalateKill(deps, runtime);
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (deps.signal !== undefined) {
    if (deps.signal.aborted) stop();
    else deps.signal.addEventListener('abort', stop, { once: true });
  }

  try {
    try {
      cookie = await signInOwner(deps.fetch, config, controller.signal);
      for (const value of cookieValues(cookie)) deps.log(`::add-mask::${value}`);
      summary.owner = 'ok';
    } catch {}

    if (cookie !== '') {
      try {
        summary.leftover = await sweepLeftovers(deps, config, cookie, controller.signal);
      } catch {
        summary.leftover = 'failed';
      }
      let code = '';
      try {
        code = await issuePairingCode(deps.fetch, config, cookie, controller.signal);
        deps.log(`::add-mask::${code}`);
        summary.pairing = 'issued';
      } catch {}
      if (code !== '') {
        label = buildDeviceLabel(config);
        try {
          await runUiTest(deps, config, cookie, code, label, runtime, summary, controller);
        } catch {}
      }
    }
  } finally {
    await startRevoke();
    if (cookie === '') summary.signOut = 'skipped';
    else {
      try {
        await signOutOwner(deps.fetch, cookie);
        summary.signOut = 'done';
      } catch {
        summary.signOut = 'failed';
      }
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    for (const line of summaryLines(summary)) deps.log(line);
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
