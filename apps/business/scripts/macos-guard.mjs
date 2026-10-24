#!/usr/bin/env node
// حارس الـ macOS (ADR-0055 قرار 6): هو اللي بيقول «ابدأ runner على macOS ولا لأ».
//
// القرار بيتاخد على Ubuntu قبل أي runner على macOS (قاعدة 1)، وكل نداء لـ GitHub بيعدي
// من io واحد متحقق فيه — عشان الاختبار يقود القواعد الست كلها من غير شبكة.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createGithubIo, SLOT_REF_PREFIX } from './macos-guard-github.mjs';

export { SLOT_REF_PREFIX };

export const DEFAULT_SLOTS = 2;
export const DEFAULT_TIMEOUT_MINUTES = 45;
export const DEFAULT_LEASE_MINUTES = 120;
export const DEFAULT_ALLOWANCE_MINUTES = 120;

const MINUTE_MS = 60_000;

/**
 * مفتاح المالك بتاع الحجز: من غيره حد تاني يقدر ياخد خانة العامل ده.
 * @param {{ runId: string, runAttempt: string, jobKey: string, flavour: string }} parts
 * @returns {string}
 */
export function ownerKey({ runId, runAttempt, jobKey, flavour }) {
  return `${runId}/${runAttempt}/${jobKey}/${flavour}`;
}

/**
 * الحارس نفسه: تلات أوامر، وكل واحدة بترجع النتيجة بتاعتها من غير ما تكسر الـ job.
 * @param {{ io: object, config: object }} parts
 * @returns {{ admit: () => Promise<object>, accept: (hint?: object) => Promise<object>, release: () => Promise<object> }}
 */
export function createGuard({ io, config }) {
  return {
    admit: () => admit({ io, config }),
    accept: (hint) => accept({ io, config, hint }),
    release: () => release({ io, config }),
  };
}

function refusal(config, reason, count = null) {
  return { admitted: false, slot: null, owner: config.owner, count, reason };
}

async function readSlots(io, config) {
  const slots = [];
  for (let index = 1; index <= config.slots; index += 1) {
    const slot = await io.readSlot(index);
    if (slot !== null && slot !== undefined) slots.push(slot);
  }
  return slots;
}

function isMacosJob(job) {
  return job.labels.some((label) => label === 'macos' || label.startsWith('macos-'));
}

/**
 * عدّ الدقائق (قاعدة 3): المهمة اللي خلصت بتتقصّ بدقائقها الحقيقية، والدقيقة الناقصة
 * بتتقصّ لفوق؛ والمهمة اللي لسه شغالة بتتقصّ بالـ timeout بتاعها. العدّ بيتعمل على الـ
 * jobs نفسها، فالمهمة الواحدة بتتقصّ مرة واحدة بس — مش مرتين (دقائقها الحقيقية و timeout
 * في نفس الوقت).
 */
function countMacosMinutes(jobs, { slots, timeoutMinutes, now }) {
  const admittedRuns = new Set(
    slots.map((slot) => String(slot.owner).split('/').slice(0, 2).join('/')),
  );
  const date = new Date(now);
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  let total = 0;
  for (const job of jobs) {
    if (!isMacosJob(job)) continue;
    const finished = job.conclusion !== null && job.conclusion !== undefined;
    if (finished) {
      if (job.startedAt === null || job.completedAt === null) continue;
      if (job.startedAt < month) continue;
      total += Math.ceil((job.completedAt - job.startedAt) / MINUTE_MS);
      continue;
    }
    const admitted = admittedRuns.has(`${job.runId}/${job.runAttempt}`);
    if (job.startedAt === null && !admitted) continue;
    total += timeoutMinutes;
  }
  return total;
}

async function admit({ io, config }) {
  // قاعدة 1 (ADR-0055 قرار 6): القرار ده Ubuntu بس، وقبل أي runner على macOS.
  if (config.runnerOs !== 'Linux') return refusal(config, 'the guard runs on ubuntu only');
  // المستودع العام: الدقائق المجانية مش بتتحسب، فمفيش حجز ولا عدّ — والقرار بيبقى «اهبط».
  if (config.mode === 'public') {
    return { admitted: true, slot: null, owner: config.owner, count: null, reason: null };
  }

  const now = config.now();
  let jobs;
  let slots;
  try {
    jobs = await io.listMacosJobs();
    slots = await readSlots(io, config);
  } catch (error) {
    // قاعدة 6 (ADR-0055 قرار 6): أي خطأ في القراءة = رفض، مش تخمين.
    return refusal(config, `the guard could not read the repository: ${error.message}`);
  }

  const count = countMacosMinutes(jobs, { slots, timeoutMinutes: config.timeoutMinutes, now });

  // قاعدة 4 (ADR-0055 قرار 6): لازم السقف يسع K شغال في نفس الوقت، ولازم يفضل اتنين
  // تحت السقف قبل ما شغلانة جديدة تنزل.
  if (config.allowanceMinutes < config.slots * config.timeoutMinutes) {
    return refusal(config, 'the allowance leaves no room for the K slots', count);
  }
  if (count + config.timeoutMinutes >= config.allowanceMinutes) {
    const reason = `the monthly allowance is reached (${count} + ${config.timeoutMinutes} >= ${config.allowanceMinutes})`;
    return refusal(config, reason, count);
  }

  // قاعدة 2 (ADR-0055 قرار 6): الخانة واحدة من K refs، بتتعمل ذرّياً بإنشاء الـ ref — اللي
  // بيوجد فعلاً بيفشل. والإيجار المنتهي بيرجع، عشان خانة ضايعة ما تحبسش الباقي.
  const admission = {
    version: 1,
    owner: config.owner,
    leaseEnd: new Date(now + config.leaseMinutes * MINUTE_MS).toISOString(),
  };
  for (let index = 1; index <= config.slots; index += 1) {
    const existing = slots.find((slot) => slot.slot === index);
    if (existing !== undefined) {
      const leaseEnd = Date.parse(existing.leaseEnd);
      if (existing.owner === config.owner && leaseEnd > now) {
        return { admitted: true, slot: index, owner: config.owner, count, reason: null };
      }
      if (leaseEnd > now) continue;
      try {
        await io.deleteSlot(index);
      } catch (error) {
        if (error.code === 'not-found') continue;
        return refusal(config, `the expired slot could not be reclaimed: ${error.message}`, count);
      }
    }
    try {
      await io.createSlot(index, admission);
      return { admitted: true, slot: index, owner: config.owner, count, reason: null };
    } catch (error) {
      if (error.code === 'conflict') continue;
      return refusal(config, `the slot could not be reserved: ${error.message}`, count);
    }
  }
  return refusal(config, 'every slot is taken', count);
}

async function accept({ io, config, hint }) {
  // المستودع العام: مفيش حجز، فالمحاولة بتقبل على طول.
  if (config.mode === 'public') {
    return { accepted: true, slot: null, owner: config.owner, reason: null };
  }
  let slots;
  try {
    slots = await readSlots(io, config);
  } catch (error) {
    return { accepted: false, slot: null, owner: config.owner, reason: error.message };
  }
  // قاعدة 5 (ADR-0055 قرار 6): القبول بياخد التطابق التام بس — نفس الـ owner key بتاع الشغلانة
  // دي، وإيجار ما انتهاش. رقم الخانة اللي الـ preflight بعتاله hint بس؛ التطابق هو اللي بيقرر.
  const hinted = hint?.slot === undefined ? undefined : slots.find((slot) => slot.slot === hint.slot);
  const candidates = [hinted, ...slots].filter((slot) => slot !== undefined);
  const now = config.now();
  const match = candidates.find(
    (slot) => slot.owner === config.owner && Date.parse(slot.leaseEnd) > now,
  );
  if (match === undefined) {
    return {
      accepted: false,
      slot: null,
      owner: config.owner,
      reason: 'no unexpired admission belongs to this job',
    };
  }
  return { accepted: true, slot: match.slot, owner: match.owner, reason: null };
}

async function release({ io, config }) {
  // المستودع العام: مفيش خانة تتحرر، وده مش خطأ.
  if (config.mode === 'public') {
    return { released: false, slot: null, failed: false, reason: 'public mode holds no slot' };
  }
  let slots;
  try {
    slots = await readSlots(io, config);
  } catch (error) {
    return { released: false, slot: null, failed: true, reason: error.message };
  }
  // الخانة بتاعت الشغلانة دي بس — خانة غيرنا ما بتتمسّش.
  const mine = slots.find((slot) => slot.owner === config.owner);
  if (mine === undefined) {
    return { released: false, slot: null, failed: false, reason: 'this job holds no slot' };
  }
  try {
    await io.deleteSlot(mine.slot);
  } catch (error) {
    return { released: false, slot: mine.slot, failed: true, reason: error.message };
  }
  return { released: true, slot: mine.slot, failed: false, reason: null };
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function configFromEnv(env) {
  const runId = env.GITHUB_RUN_ID ?? '';
  const runAttempt = env.GITHUB_RUN_ATTEMPT ?? '1';
  const jobKey = env.MACOS_GUARD_JOB_KEY ?? '';
  const flavour = env.MACOS_GUARD_FLAVOUR ?? '';
  return {
    // MACOS_GUARD_MODE هو قرار الـ workflow: public (المستودع العام) ولا enforce (الحجز والعدّ).
    mode: env.MACOS_GUARD_MODE === 'public' ? 'public' : 'enforce',
    runnerOs: env.RUNNER_OS ?? '',
    owner: ownerKey({ runId, runAttempt, jobKey, flavour }),
    slots: numberFromEnv(env.MACOS_GUARD_SLOTS, DEFAULT_SLOTS),
    timeoutMinutes: numberFromEnv(env.MACOS_GUARD_JOB_TIMEOUT_MINUTES, DEFAULT_TIMEOUT_MINUTES),
    leaseMinutes: numberFromEnv(env.MACOS_GUARD_LEASE_MINUTES, DEFAULT_LEASE_MINUTES),
    allowanceMinutes: numberFromEnv(env.MACOS_GUARD_ALLOWANCE_MINUTES, DEFAULT_ALLOWANCE_MINUTES),
    now: () => Date.now(),
  };
}

function writeOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(file, `${lines.join('\n')}\n`);
}

// الرفض بيوقّف الـ job هنا: القرار مرفوض مفيش runner على macOS، وقرار القبول مرفوض
// الشغلانة بتوقف في أول دقيقة.
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(command) {
  const config = configFromEnv(process.env);
  const io = createGithubIo({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    headSha: process.env.GITHUB_SHA,
  });
  const guard = createGuard({ io, config });

  if (command === 'admit') {
    const result = await guard.admit();
    writeOutputs({
      admitted: String(result.admitted),
      slot: result.slot === null ? '' : String(result.slot),
      owner: result.owner,
    });
    if (!result.admitted) fail(`macos-guard refused the admission: ${result.reason}`);
    return;
  }

  if (command === 'accept') {
    const hintSlot = Number(process.env.MACOS_GUARD_EXPECTED_SLOT);
    const result = await guard.accept(
      Number.isFinite(hintSlot) && hintSlot > 0 ? { slot: hintSlot } : undefined,
    );
    if (!result.accepted) fail(`macos-guard refused the admission: ${result.reason}`);
    return;
  }

  if (command === 'release') {
    const result = await guard.release();
    if (result.failed) fail(`macos-guard did not release a slot: ${result.reason}`);
    return;
  }

  process.stderr.write('Usage: node macos-guard.mjs <admit|accept|release>\n');
  process.exit(2);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main(process.argv[2]);
}
