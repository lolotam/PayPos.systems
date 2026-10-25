// منسّق اختبار الاقتران والـ PIN على محاكي iOS (spec 065، M-1c): بيشغّل الـ xcodebuild
// وبيستطلع الأجهزة المعلّقة. الشبكة في counter-auth-api.mjs والأسماء في counter-auth-labels.mjs.

import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  changeDevice,
  cookieValues,
  fetchPendingDevicePages,
  preparePairing,
  readConfig,
  revokeDeviceByLabel,
  signInOwner,
  signOutOwner,
} from './counter-auth-api.mjs';
import {
  buildDeviceLabel,
  buildUiTestEnvironment,
  matchDeviceLabel,
  summaryLines,
} from './counter-auth-labels.mjs';

// إعادة التصدير: سكربت الاختبار بيستورد من الملف ده من زمان، فالمكانش لازم يتغير.
export { collectCookies, fetchPendingDevicePages } from './counter-auth-api.mjs';
export { buildUiTestEnvironment, matchDeviceLabel } from './counter-auth-labels.mjs';

// حدود التشغيل: الـ xcodebuild عنده 20 دقيقة، وبعد SIGTERM عنده 15 ثانية قبل SIGKILL.
const UI_TEST_LIMIT_MS = 20 * 60_000;
const KILL_GRACE_MS = 15_000;
const KILL_WAIT_TICKS = 60;
const POLL_INTERVAL_MS = 3_000;
const DEATH_WAIT_TICK_MS = 1_000;

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

async function startUiTest(deps, config, code, label) {
  const spike = join(config.RUNNER_TEMP, 'spike');
  const privateDir = join(spike, 'private');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(privateDir, 'counter-auth-xcodebuild.log'), 'w', 0o600);
  try {
    const child = deps.spawn('xcodebuild', [
      'test',
      '-project', join(spike, 'SpikeUITests.xcodeproj'), '-scheme', 'SpikeUITests',
      '-only-testing:SpikeUITests/CounterAuthUITests', '-destination', `id=${config.SPIKE_UDID}`,
      '-resultBundlePath', join(spike, 'CounterAuth.xcresult'),
      'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_REQUIRED=NO', 'DEVELOPMENT_TEAM=',
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

/**
 * الاستطلاع بيستمر طول ما الـ xcodebuild شغال، وكل جولة مستقلة: جولة فشلت بسبب شبكة
 * بتتعاود في الجولة الجاية بدل ما تخلّص التشغيل.
 */
async function supervise(deps, config, runtime, summary, controller) {
  const deadline = deps.now() + UI_TEST_LIMIT_MS;
  const cookie = runtime.cookie;
  let found = false;
  while (!controller.signal.aborted && !runtime.closed) {
    try {
      if (runtime.deviceId === null) {
        const pages = await fetchPendingDevicePages(deps.fetch, config, cookie, controller.signal);
        const id = matchDeviceLabel(pages, runtime.label);
        if (id !== null) {
          runtime.deviceId = id;
          found = true;
        }
      }
      if (runtime.deviceId !== null && summary.approval !== 'approved') {
        await changeDevice(deps.fetch, config, cookie, 'approve', runtime.deviceId, controller.signal);
        summary.approval = 'approved';
      }
    } catch {
      // جولة فشلت: الجولة الجاية بتجرب تاني، والجهاز يفضل متسجّل عشان يتشال في الآخر.
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

async function runUiTest(deps, config, code, runtime, summary, controller) {
  const started = await startUiTest(deps, config, code, runtime.label);
  runtime.child = started.child;
  // المستمعين بيتسجلوا قبل أي قتل: مينفعش ChildProcess يخرج ونفقد الحدث.
  const childOutcome = waitForChild(runtime);
  if (controller.signal.aborted) escalateKill(deps, runtime);
  try {
    await supervise(deps, config, runtime, summary, controller);
    // بعد القتل بنستنى الموت بمقدار محدود، وبعدها بنعتبره ميت عشان التشغيل ما يعلقش.
    for (let tick = 0; tick < KILL_WAIT_TICKS && !runtime.closed; tick += 1) {
      try {
        await deps.sleep(DEATH_WAIT_TICK_MS);
      } catch {
        break;
      }
    }
    if (!runtime.closed) runtime.forceClose?.();
    summary.ui = await childOutcome;
  } finally {
    // لو حصل خطأ قبل ما الطفل يخلص، ما بنسيبش شغلان جاري بعد انتهاء التشغيل.
    if (!runtime.closed) escalateKill(deps, runtime);
    await started.closeLog();
  }
}

/** آخر بحث بالاسم ثم مراجعة الجهاز: بتتشال من غير ما نستنى الـ close. */
async function revokeDevice(deps, config, runtime, summary) {
  const outcome = await revokeDeviceByLabel(
    deps, config, runtime.cookie, runtime.label, runtime.deviceId,
  );
  if (outcome.id !== null) runtime.deviceId = outcome.id;
  summary.revoke = outcome.outcome;
}

/** أول إشارة بتوقف التشغيل وبتبدأ المراجعة مع القتل، مش بعد ما الطفل يخرج. */
function listenForStop(deps, controller, runtime, startRevoke) {
  const stop = () => {
    if (runtime.interrupted) return;
    runtime.interrupted = true;
    controller.abort();
    void startRevoke();
    escalateKill(deps, runtime);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (deps.signal?.aborted === true) stop();
  else deps.signal?.addEventListener('abort', stop, { once: true });
  return stop;
}

/** دخول الـ owner وقناع قيم الـ cookie عشان ما تظهرش في الـ log. */
async function signInOwnerAndMask(deps, config, controller, runtime, summary) {
  try {
    runtime.cookie = await signInOwner(deps.fetch, config, controller.signal);
    for (const value of cookieValues(runtime.cookie)) deps.log(`::add-mask::${value}`);
    summary.owner = 'ok';
  } catch {}
}

/** كود الاقتران وتشغيل اختبار iOS على المحاكي. */
async function sweepAndPair(deps, config, controller, runtime, summary) {
  const { leftover, code } = await preparePairing(deps, config, runtime.cookie, controller.signal);
  summary.leftover = leftover;
  if (code === '') return;
  deps.log(`::add-mask::${code}`);
  summary.pairing = 'issued';
  runtime.label = buildDeviceLabel(config);
  try {
    await runUiTest(deps, config, code, runtime, summary, controller);
  } catch {}
}

/** آخر تنظيف: مرور أخير محدود لمراجعة الجهاز لو لسه ما اتلغاش، إنهاء جلسة الـ owner، وطباعة سطور النتيجة. */
async function finalize(deps, config, runtime, summary, startRevoke, stop) {
  await startRevoke();
  if (summary.revoke !== 'done' && runtime.label !== '') {
    // مرور أخير: الجهاز ممكن يتسجّل بعد ما المراجعة بدأت، أو تفشل محاولاتها كلها
    // فيبقى ACTIVE على الستينج. البحث بالاسم لو الـ id مش معروف، ومراجعته لو معروف.
    await revokeDevice(deps, config, runtime, summary);
  }
  summary.signOut = runtime.cookie === '' ? 'skipped' : await signOutOwner(deps.fetch, runtime.cookie);
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  for (const line of summaryLines(summary)) deps.log(line);
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
  const runtime = {
    cookie: '',
    label: '',
    deviceId: null,
    child: null,
    closed: false,
    escalated: false,
    interrupted: false,
  };
  const controller = new AbortController();
  let revokeTask = null;

  // المراجعة بتبدأ مع القتل مش بعده: مفيش انتظار مفتوح على close قبل ما الجهاز يتشال.
  const startRevoke = () => {
    if (revokeTask !== null) return revokeTask;
    revokeTask = revokeDevice(deps, config, runtime, summary);
    return revokeTask;
  };

  const stop = listenForStop(deps, controller, runtime, startRevoke);
  try {
    await signInOwnerAndMask(deps, config, controller, runtime, summary);
    if (runtime.cookie !== '') await sweepAndPair(deps, config, controller, runtime, summary);
  } finally {
    await finalize(deps, config, runtime, summary, startRevoke, stop);
  }
  return !runtime.interrupted && summary.ui === 'passed' && summary.revoke === 'done' ? 0 : 1;
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
