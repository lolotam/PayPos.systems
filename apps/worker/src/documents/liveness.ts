import {
  DOCUMENT_RENDERER_ALIVE_KEY,
  DOCUMENT_RENDERER_ALIVE_TTL_SECONDS,
} from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import type { Redis } from 'ioredis';

export interface RendererLiveness {
  stop(): Promise<void>;
}

const READY_TIMEOUT_MS = 30_000;
/** أمر Redis اللي ما بيردّش. أقصر من إغلاق المتصفح عشان الإيقاف ما يستناش الاتنين ورا بعض. */
const COMMAND_TIMEOUT_MS = 2_000;

/**
 * الاتصال لسه مش جاهز. `enableOfflineQueue` مقفول، فالأمر المبكر بيترفض والمفتاح ما بيتكتبش.
 * الانتظار متسقوف عشان Redis اللي ما بيبعتش ready ما يعلّقش إقلاع الوركر.
 */
function whenRedisReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  if (redis.status === 'end') return Promise.reject(new Error('redis ended'));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('end', onEnd);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReady = (): void => finish();
    const onEnd = (): void => finish(new Error('redis ended'));
    const timer = setTimeout(() => finish(new Error('redis ready timed out')), timeoutMs);
    redis.on('ready', onReady);
    redis.on('end', onEnd);
    if (redis.status === 'ready') finish();
    else if (redis.status === 'wait') {
      void Promise.resolve(redis.connect()).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('redis connect failed'));
      });
    }
  });
}

function settled(work: unknown): Promise<unknown> {
  return Promise.resolve(work).catch(() => undefined);
}

/**
 * Redis المتصل اللي بيسكت بيكدّس أوامر لو كل تيك استنى اللي قبله.
 * بعد المهلة بنسيب الأمر يكمل لوحده، والرفض المتأخر بيترمى.
 */
function boundCommand(work: Promise<unknown>, ms: number): Promise<void> {
  const done = settled(work).then(() => undefined);
  if (!(ms > 0)) return done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([done, wait]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

interface PublishState {
  redis: Redis;
  renderer: DocumentRenderer;
  ttlSeconds: number;
  intervalMs: number;
  commandTimeoutMs: number;
  epoch: number;
  stopped: boolean;
  busy: boolean;
  timer: ReturnType<typeof setInterval> | undefined;
}

function isLive(state: PublishState): boolean {
  return !state.stopped && state.renderer.isAvailable();
}

function watchSet(state: PublishState, set: Promise<unknown>): void {
  void settled(set).finally(() => {
    state.busy = false;
  });
}

/**
 * تيك جديد ما يبعتش SET تاني والقديم لسه معلّق.
 * العلم بيفضل لحد ما الأمر نفسه يخلّص، مش لحد مهلة الانتظار، عشان المهلة ما تفتحش طابور أوامر.
 */
async function publishOnce(state: PublishState): Promise<void> {
  if (!isLive(state) || state.busy) return;
  state.busy = true;
  const token = state.epoch;
  const set = state.redis.set(DOCUMENT_RENDERER_ALIVE_KEY, '1', 'EX', state.ttlSeconds);
  watchSet(state, set);
  await boundCommand(set, state.commandTimeoutMs);
  if (token !== state.epoch || !isLive(state)) {
    await boundCommand(state.redis.del(DOCUMENT_RENDERER_ALIVE_KEY), state.commandTimeoutMs);
  }
}

async function haltPublish(state: PublishState): Promise<void> {
  state.epoch += 1;
  if (state.timer !== undefined) clearInterval(state.timer);
  state.timer = undefined;
  await boundCommand(state.redis.del(DOCUMENT_RENDERER_ALIVE_KEY), state.commandTimeoutMs);
}

function armInterval(state: PublishState): void {
  if (!isLive(state) || state.timer !== undefined) return;
  void publishOnce(state);
  state.timer = setInterval(() => {
    void publishOnce(state);
  }, state.intervalMs);
}

function stopLiveness(state: PublishState): Promise<void> {
  state.stopped = true;
  return haltPublish(state);
}

/**
 * بيجدّد مفتاح الحياة ما دام المتصفح متاح، وبيمسحه فور ما يقع أو الوركر يقفل.
 * SET اتبدأ قبل القطع بيتمسح بعد ما يخلّص، عشان الرد المتأخر ما يعلنش متصفح ميت.
 * الانتهاء بعد ٣ ثواني لسه بيمسك الانهيار لو المسح نفسه ما لحقش.
 * أمر واحد في الطيران، وانتظاره متسقوف، عشان Redis الساكت ما يكدّسش أوامر ولا يعلّق الإيقاف.
 * لو الإقلاع فشل، ما بيتبقاش حاجة مسلّحة: المستمع الميت بيلاقي الناشر واقف.
 */
export async function startRendererLiveness(input: {
  readonly redis: Redis;
  readonly renderer: DocumentRenderer;
  readonly intervalMs?: number;
  readonly ttlSeconds?: number;
  readonly readyTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
}): Promise<RendererLiveness> {
  const state: PublishState = {
    redis: input.redis,
    renderer: input.renderer,
    ttlSeconds: input.ttlSeconds ?? DOCUMENT_RENDERER_ALIVE_TTL_SECONDS,
    intervalMs: input.intervalMs ?? 1_000,
    commandTimeoutMs: input.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
    epoch: 0,
    stopped: false,
    busy: false,
    timer: undefined,
  };
  input.renderer.onAvailable(() => {
    armInterval(state);
  });
  input.renderer.onUnavailable(() => {
    void haltPublish(state);
  });
  try {
    await whenRedisReady(input.redis, input.readyTimeoutMs ?? READY_TIMEOUT_MS);
    await publishOnce(state);
  } catch (error) {
    // الناشر الفاشل لازم يقف من غير ما يسيب مستمع يسلّح تيك من بعده.
    await stopLiveness(state).catch(() => undefined);
    throw error;
  }
  if (isLive(state) && state.timer === undefined) {
    state.timer = setInterval(() => {
      void publishOnce(state);
    }, state.intervalMs);
  }
  return {
    stop: () => stopLiveness(state),
  };
}
