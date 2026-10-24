#!/usr/bin/env node
// حارس الـ macOS (ADR-0055 قرار 6): هو اللي بيقول «ابدأ runner على macOS ولا لأ». القرار
// بيتاخد على Ubuntu قبل أي runner على macOS (قاعدة 1)، وكل نداء لـ GitHub بيعدي من io واحد
// متحقق فيه — عشان الاختبار يقود القواعد الست كلها من غير شبكة.

import { pathToFileURL } from 'node:url';

import { createGithubIo, SLOT_REF_PREFIX } from './macos-guard-github.mjs';

export { SLOT_REF_PREFIX };

export const DEFAULT_SLOTS = 2;
export const DEFAULT_TIMEOUT_MINUTES = 45;
export const DEFAULT_LEASE_MINUTES = 120;
export const DEFAULT_ALLOWANCE_MINUTES = 180;

const MINUTE_MS = 60_000;

/**
 * مفتاح المالك بتاع الحجز: من غيره حد تاني يقدر ياخد خانة العامل ده.
 * @param {{ runId: string, runAttempt: string, jobKey: string, flavour: string }} parts
 * @returns {string}
 */
export function ownerKey({ runId, runAttempt, jobKey, flavour }) {
  return `${runId}/${runAttempt}/${jobKey}/${flavour}`;
}

/** الحارس نفسه: تلات أوامر، وكل واحدة بترجع النتيجة بتاعتها من غير ما تكسر الـ job. */
export function createGuard({ io, config }) {
  return {
    admit: () => admit({ io, config }),
    accept: () => accept({ io, config }),
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
 * عدّ الدقائق (قاعدة 3): الدقائق الفعلية للمهام اللي خلصت الشهر ده (كل واحدة مق.round لفوق)،
 * + الـ timeout لكل خانة محجوزة لسه سليمة بتاعة مالك تاني، + الـ timeout لكل شغلانة macOS
 * لسه شغالة مالها خانة ومش من تشغيلنا. فالمهمة الواحدة بتتقصّ مرة واحدة بس.
 */
function countMacosMinutes(jobs, { slots, timeoutMinutes, now, owner, run }) {
  const date = new Date(now);
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const heldRuns = new Set();
  let total = 0;
  for (const slot of slots) {
    if (Date.parse(slot.leaseEnd) <= now) continue;
    heldRuns.add(String(slot.owner).split('/').slice(0, 2).join('/'));
    if (slot.owner === owner) continue;
    total += timeoutMinutes;
  }
  for (const job of jobs) {
    if (!isMacosJob(job)) continue;
    const finished = job.conclusion !== null && job.conclusion !== undefined;
    if (finished) {
      if (job.startedAt === null || job.completedAt === null) continue;
      if (job.startedAt < month) continue;
      total += Math.ceil((job.completedAt - job.startedAt) / MINUTE_MS);
      continue;
    }
    const jobRun = `${job.runId}/${job.runAttempt}`;
    if (jobRun === run) continue;
    if (heldRuns.has(jobRun)) continue;
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

  const count = countMacosMinutes(jobs, {
    slots,
    timeoutMinutes: config.timeoutMinutes,
    now,
    owner: config.owner,
    run: config.run,
  });

  // قاعدة 4 (ADR-0055 قرار 6): لازم السقف يسع K شغال كلهم في نفس الوقت، ولازم يفضل تحت
  // السقف بعد ما كل الخانات تاخد timeout بتاعها — فتلات تشغيلات مع بعض ما تتجاوزوش السقف.
  if (config.allowanceMinutes < config.slots * config.timeoutMinutes) {
    return refusal(config, 'the allowance leaves no room for the K slots', count);
  }
  const room = config.slots * config.timeoutMinutes;
  if (count + room > config.allowanceMinutes) {
    const reason = `the monthly allowance is reached (${count} + ${room} > ${config.allowanceMinutes})`;
    return refusal(config, reason, count);
  }

  const admission = {
    version: 1,
    owner: config.owner,
    leaseEnd: new Date(now + config.leaseMinutes * MINUTE_MS).toISOString(),
  };
  return claimSlot({ io, config, slots, admission, now, count });
}

/**
 * قاعدة 2 (ADR-0055 قرار 6): الخانة واحدة من K refs، بتتعمل ذرّياً بإنشاء الـ ref، والإيجار
 * المنتهي بيرجع — عشان خانة ضايعة ما تحبسش الباقي.
 */
async function claimSlot({ io, config, slots, admission, now, count }) {
  for (let index = 1; index <= config.slots; index += 1) {
    const existing = slots.find((slot) => slot.slot === index);
    const result = await claimIndex({ io, config, existing, index, admission, now, count });
    if (result !== null) return result;
  }
  return refusal(config, 'every slot is taken', count);
}

async function claimIndex({ io, config, existing, index, admission, now, count }) {
  if (existing === undefined) return claimFreeSlot(io, config, index, admission, count);
  const leaseEnd = Date.parse(existing.leaseEnd);
  if (existing.owner === config.owner && leaseEnd > now) {
    return { admitted: true, slot: index, owner: config.owner, count, reason: null };
  }
  if (leaseEnd > now) return null;
  // استرجاع الخانة المنتهية compare-and-swap: الـ commit الجديد ابن الـ commit القديم،
  // والـ ref بيتنقل force:false — فلو حد تاني نقله في نفس اللحظة، هنخسر الخانة دي
  // ونجرب اللي بعدها.
  try {
    const sha = await io.createCommit(admission, existing.sha);
    await io.moveSlot(index, sha);
    return { admitted: true, slot: index, owner: config.owner, count, reason: null };
  } catch (error) {
    if (error.code === 'conflict') return null;
    return refusal(config, `the expired slot could not be reclaimed: ${error.message}`, count);
  }
}

async function claimFreeSlot(io, config, index, admission, count) {
  try {
    const sha = await io.createCommit(admission, null);
    await io.createSlot(index, sha);
    return { admitted: true, slot: index, owner: config.owner, count, reason: null };
  } catch (error) {
    if (error.code !== 'conflict') {
      return refusal(config, `the slot could not be reserved: ${error.message}`, count);
    }
    // الـ ref موجود: يا خانة حيّة بتاعة حد تاني (مالهاش لينا)، يا خانة محرَّرة (بناخدها
    // بنفس الـ compare-and-swap بتاع الخانة المنتهية: commit ابن + PATCH force:false).
    if (error.released !== true) return null;
    try {
      const child = await io.createCommit(admission, error.currentSha);
      await io.moveSlot(index, child);
      return { admitted: true, slot: index, owner: config.owner, count, reason: null };
    } catch (moveError) {
      if (moveError.code === 'conflict') return null;
      return refusal(config, `the released slot could not be taken: ${moveError.message}`, count);
    }
  }
}

async function accept({ io, config }) {
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
  // قاعدة 5 (ADR-0055 قرار 6): القبول بياخد التطابق التام بس — نفس الـ owner key بتاعنا،
  // وإيجار ما انتهاش.
  const now = config.now();
  const match = slots.find((slot) => slot.owner === config.owner);
  if (match === undefined) {
    return {
      accepted: false,
      slot: null,
      owner: config.owner,
      reason: 'no admission for this job',
    };
  }
  // الإيجار لازم يغطي timeout الشغلانة كلها: runner استنى في الطابور طويل يبقى متبقيلوش
  // وقت يخلص، والخانة بتاعته ممكن تتحرر وتتفتح لشغلانة تانية.
  const remaining = Date.parse(match.leaseEnd) - now;
  if (remaining < config.timeoutMinutes * MINUTE_MS) {
    const minutes = Math.max(0, Math.floor(remaining / MINUTE_MS));
    return {
      accepted: false,
      slot: null,
      owner: config.owner,
      reason: `the lease has ${minutes} minutes left, less than the job timeout (${config.timeoutMinutes})`,
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
  // الخانة بتاعت الشغلانة دي بس — خانة غيرنا ما بتتمسّش. والحرية مش حذف: الـ ref بيتنقل
  // force:false على commit ابن اللي اتقرا، فـ«الحذف» مابيكسرش حجز حد تاني اتكتب في نفس
  // اللحظة. ولو التحديث اترفض، الخانة مش بقت بتاعتنا.
  const mine = slots.find((slot) => slot.owner === config.owner);
  if (mine === undefined) {
    return { released: false, slot: null, failed: false, reason: 'this job holds no slot' };
  }
  try {
    const sha = await io.createCommit({ version: 1, released: true }, mine.sha);
    await io.moveSlot(mine.slot, sha);
    return { released: true, slot: mine.slot, failed: false, reason: null };
  } catch (error) {
    if (error.code === 'conflict') {
      return { released: false, slot: mine.slot, failed: false, reason: 'not mine any more' };
    }
    return { released: false, slot: mine.slot, failed: true, reason: error.message };
  }
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
    run: `${runId}/${runAttempt}`,
    slots: numberFromEnv(env.MACOS_GUARD_SLOTS, DEFAULT_SLOTS),
    timeoutMinutes: numberFromEnv(env.MACOS_GUARD_JOB_TIMEOUT_MINUTES, DEFAULT_TIMEOUT_MINUTES),
    leaseMinutes: numberFromEnv(env.MACOS_GUARD_LEASE_MINUTES, DEFAULT_LEASE_MINUTES),
    allowanceMinutes: numberFromEnv(env.MACOS_GUARD_ALLOWANCE_MINUTES, DEFAULT_ALLOWANCE_MINUTES),
    now: () => Date.now(),
  };
}

// الرفض بيوقّف الـ job هنا: القرار مرفوض مفيش runner على macOS، والقبول المرفوض بيوقّف
// الشغلانة في أول دقيقة.
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
    if (!result.admitted) fail(`macos-guard refused the admission: ${result.reason}`);
    process.stdout.write(
      `macos-guard admitted the slot ${result.slot ?? 'none'} for ${result.owner}\n`,
    );
    return;
  }

  if (command === 'accept') {
    const result = await guard.accept();
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
if (isMain) await main(process.argv[2]);
