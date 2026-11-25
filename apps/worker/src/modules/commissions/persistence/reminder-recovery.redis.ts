import type { Redis } from 'ioredis';

import {
  REMINDER_RECOVERY_KEY,
  REMINDER_RECOVERY_SLOT_KEY,
  REMINDER_SENTINEL_KEY,
  parseReminderLease,
  parseReminderSentinel,
  parseReminderSlot,
  type ReminderSlot,
} from '../domain/reminder-recovery.ts';
import type {
  ReminderRecoveryProbe,
  ReminderRecoverySnapshot,
  ReminderRecoveryStore,
  ReminderPublishInput,
} from '../ports/reminder-recovery.port.ts';

const GUARD = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, doc = pcall(cjson.decode, raw)
if not ok or type(doc) ~= 'table' then return 0 end
if doc['pass_id'] ~= ARGV[1] then return 0 end
`;

const ACQUIRE = `
local ok = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')
if ok then return 1 else return 0 end
`;

const RENEW = `
${GUARD}
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE = `
${GUARD}
redis.call('DEL', KEYS[1])
return 1
`;

const SET_INCIDENT = `
${GUARD}
doc['incident_id'] = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(doc), 'EX', ARGV[3])
return 1
`;

const WRITE_SLOT = `
${GUARD}
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
`;

const INVALIDATE_SENTINEL = `
${GUARD}
redis.call('DEL', KEYS[2])
return 1
`;

const PUBLISH = `
${GUARD}
local current = doc['incident_id']
if current == nil or current == cjson.null then current = '' end
if current ~= ARGV[2] then return 0 end
local info = redis.call('INFO', 'server')
local run = string.match(info, 'run_id:([0-9a-f]+)')
if not run or run ~= ARGV[3] then return 0 end
redis.call('SET', KEYS[2], ARGV[4])
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[3])
return 1
`;

/** يستخرج معرّف تشغيل الخادم من مخرجات INFO. */
export function parseServerRunId(info: string): string | null {
  const match = /run_id:([0-9a-f]{40})/.exec(info);
  return match?.[1] ?? null;
}

/** قيمة نصية من نتيجة MULTI/EXEC، أو null. */
function textOf(entry: [Error | null, unknown] | undefined): string | null {
  const value = entry?.[1];
  return typeof value === 'string' ? value : null;
}

/** نص JSON لسجل الإيقاع: نفس الشكل اللي بيقراه الـparse. */
function slotJson(slot: ReminderSlot): string {
  return JSON.stringify({
    incident_id: slot.incidentId,
    anchor: slot.anchor,
    slot: slot.slot,
    ...(slot.startupRunId === undefined ? {} : { startup_run_id: slot.startupRunId }),
    ...(slot.startupAnchor === undefined ? {} : { startup_anchor: slot.startupAnchor }),
    ...(slot.startupSlot === undefined ? {} : { startup_slot: slot.startupSlot }),
  });
}

/** نص JSON لسجل الشهادة. */
function sentinelJson(input: ReminderPublishInput): string {
  return JSON.stringify({
    release: input.release,
    run_id: input.runId,
    pass_id: input.passId,
    cutoff: input.cutoff,
    cutoff_seq: input.cutoffSeq,
  });
}

/** نص JSON لسجل الإيجار. */
function leaseJson(input: { passId: string; runId: string; incidentId: string | null }): string {
  return JSON.stringify({
    incident_id: input.incidentId,
    run_id: input.runId,
    pass_id: input.passId,
  });
}

/** المهلة الافتراضية لانتظار جاهزية اتصال Redis قبل رفض العملية بوضوح. */
const REDIS_READY_TIMEOUT_MS = 5_000;

/**
 * ينتظر جاهزية اتصال Redis قبل إرسال أي أمر لأن `enableOfflineQueue: false` بيرفض
 * الأوامر المبكرة أثناء إقلاع العامل (ADR-0061 §4).
 *
 * @param redis     اتصال Redis
 * @param timeoutMs أقصى انتظار بالمللي ثانية
 * @returns وعد يكتمل عندما يصبح الاتصال جاهزًا
 */
function whenRedisReady(redis: Redis, timeoutMs = REDIS_READY_TIMEOUT_MS): Promise<void> {
  if (redis.status === undefined || redis.status === 'ready') return Promise.resolve();
  if (redis.status === 'end') return Promise.reject(new Error('REDIS_ENDED'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('end', onEnd);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = (): void => finish();
    const onEnd = (): void => finish(new Error('REDIS_ENDED'));
    const timer = setTimeout(() => finish(new Error('REDIS_READY_TIMEOUT')), timeoutMs);
    timer.unref?.();
    redis.on('ready', onReady);
    redis.on('end', onEnd);
    if (redis.status === 'ready') finish();
    else if (redis.status === 'wait') {
      void Promise.resolve(redis.connect()).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('REDIS_CONNECT_FAILED'));
      });
    }
  });
}

/** ينفّذ سكربت Lua ويعيد نتيجة منطقية. */
async function evalScript(
  redis: Redis,
  script: string,
  keys: readonly string[],
  args: readonly (string | number)[],
): Promise<boolean> {
  await whenRedisReady(redis);
  const result = await redis.eval(
    script,
    keys.length,
    ...keys,
    ...args.map((value) => String(value)),
  );
  return Number(result) === 1;
}

/** عمليات الإيجار: الحجز والتجديد والتحرير وتسجيل الحادثة. */
function leaseOperations(
  redis: Redis,
): Pick<ReminderRecoveryStore, 'acquire' | 'renew' | 'release' | 'setIncident'> {
  return {
    acquire: async (input) =>
      evalScript(redis, ACQUIRE, [REMINDER_RECOVERY_KEY], [leaseJson(input), input.ttlSeconds]),
    renew: async (passId, ttlSeconds) =>
      evalScript(redis, RENEW, [REMINDER_RECOVERY_KEY], [passId, ttlSeconds]),
    release: async (passId) => evalScript(redis, RELEASE, [REMINDER_RECOVERY_KEY], [passId]),
    setIncident: async (passId, incidentId, ttlSeconds) =>
      evalScript(redis, SET_INCIDENT, [REMINDER_RECOVERY_KEY], [passId, incidentId, ttlSeconds]),
  };
}

/** يقرأ الشهادة والإيجار ومعرّف تشغيل الخادم ذرّيًا. */
async function readSnapshot(redis: Redis): Promise<ReminderRecoverySnapshot> {
  await whenRedisReady(redis);
  const results = await redis
    .multi()
    .get(REMINDER_SENTINEL_KEY)
    .get(REMINDER_RECOVERY_KEY)
    .info('server')
    .exec();
  const info = typeof results?.[2]?.[1] === 'string' ? results[2][1] : '';
  return {
    sentinel: parseReminderSentinel(textOf(results?.[0])),
    lease: parseReminderLease(textOf(results?.[1])),
    serverRunId: parseServerRunId(info),
  };
}

/** يقرأ الشهادة والإيجار ومعرّف التشغيل ووجود مفاتيح الجدولة ذرّيًا. */
async function readProbe(
  redis: Redis,
  schedulerKeys: readonly string[],
): Promise<ReminderRecoveryProbe> {
  await whenRedisReady(redis);
  const transaction = redis
    .multi()
    .get(REMINDER_SENTINEL_KEY)
    .get(REMINDER_RECOVERY_KEY)
    .info('server');
  for (const key of schedulerKeys) transaction.exists(key);
  const results = await transaction.exec();
  const info = typeof results?.[2]?.[1] === 'string' ? results[2][1] : '';
  return {
    sentinel: parseReminderSentinel(textOf(results?.[0])),
    lease: parseReminderLease(textOf(results?.[1])),
    serverRunId: parseServerRunId(info),
    schedulers: (results ?? []).slice(3).map((entry) => entry?.[1] === 1),
  };
}

/** عمليات الشهادة والإيقاع: اللقطة الذرّية والكتابة تحت فحص الملكية. */
function certificateOperations(
  redis: Redis,
): Pick<
  ReminderRecoveryStore,
  'snapshot' | 'probe' | 'readSlot' | 'writeSlot' | 'invalidateSentinel' | 'publish'
> {
  return {
    snapshot: () => readSnapshot(redis),
    probe: (schedulerKeys) => readProbe(redis, schedulerKeys),
    readSlot: async () => {
      await whenRedisReady(redis);
      return parseReminderSlot(await redis.get(REMINDER_RECOVERY_SLOT_KEY));
    },
    writeSlot: async (input) =>
      evalScript(
        redis,
        WRITE_SLOT,
        [REMINDER_RECOVERY_KEY, REMINDER_RECOVERY_SLOT_KEY],
        [input.passId, slotJson(input.slot), input.ttlSeconds],
      ),
    invalidateSentinel: async (passId) =>
      evalScript(
        redis,
        INVALIDATE_SENTINEL,
        [REMINDER_RECOVERY_KEY, REMINDER_SENTINEL_KEY],
        [passId],
      ),
    publish: async (input) =>
      evalScript(
        redis,
        PUBLISH,
        [REMINDER_RECOVERY_KEY, REMINDER_SENTINEL_KEY, REMINDER_RECOVERY_SLOT_KEY],
        [input.passId, input.incidentId ?? '', input.runId, sentinelJson(input)],
      ),
  };
}

/**
 * يبني متجر الاستعادة على Redis: كل العمليات الذرّية في سكربت Lua أو MULTI/EXEC،
 * وكل كتابة مشتركة مضمونة بمقارنة `pass_id` (ADR-0061 §4).
 *
 * @param redis اتصال Redis
 * @returns المتجر
 */
export function createReminderRecoveryStore(redis: Redis): ReminderRecoveryStore {
  return {
    ...leaseOperations(redis),
    ...certificateOperations(redis),
    serverRunId: async () => {
      await whenRedisReady(redis);
      return parseServerRunId(await redis.info('server'));
    },
  };
}

export type { ReminderRecoveryProbe, ReminderRecoverySnapshot };
