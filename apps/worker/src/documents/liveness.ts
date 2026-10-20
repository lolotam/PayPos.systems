import { DOCUMENT_RENDERER_ALIVE_KEY, DOCUMENT_RENDERER_ALIVE_TTL_SECONDS } from '@pospay/contracts';
import type { DocumentRenderer } from '@pospay/documents';
import type { Redis } from 'ioredis';

export interface RendererLiveness {
  stop(): Promise<void>;
}

const READY_TIMEOUT_MS = 30_000;

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

function settled(value: unknown): Promise<unknown> {
  return Promise.resolve(value).catch(() => undefined);
}

/**
 * بيجدّد مفتاح الحياة ما دام المتصفح متاح، وبيمسحه فور ما يقع أو الوركر يقفل.
 * الانتهاء بعد ٣ ثواني لسه بيمسك الانهيار لو المسح نفسه ما لحقش.
 */
export async function startRendererLiveness(input: {
  readonly redis: Redis;
  readonly renderer: DocumentRenderer;
  readonly intervalMs?: number;
  readonly ttlSeconds?: number;
  readonly readyTimeoutMs?: number;
}): Promise<RendererLiveness> {
  const ttlSeconds = input.ttlSeconds ?? DOCUMENT_RENDERER_ALIVE_TTL_SECONDS;
  const intervalMs = input.intervalMs ?? 1_000;
  const readyTimeoutMs = input.readyTimeoutMs ?? READY_TIMEOUT_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  const publish = (): Promise<unknown> =>
    settled(input.redis.set(DOCUMENT_RENDERER_ALIVE_KEY, '1', 'EX', ttlSeconds));
  const refresh = (): void => {
    void publish();
  };
  const halt = async (): Promise<void> => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    await settled(input.redis.del(DOCUMENT_RENDERER_ALIVE_KEY));
  };
  const arm = (): void => {
    if (timer !== undefined) return;
    refresh();
    timer = setInterval(refresh, intervalMs);
  };
  input.renderer.onAvailable(arm);
  input.renderer.onUnavailable(() => {
    void halt();
  });
  await whenRedisReady(input.redis, readyTimeoutMs);
  if (input.renderer.isAvailable()) {
    await settled(input.redis.set(DOCUMENT_RENDERER_ALIVE_KEY, '1', 'EX', ttlSeconds));
    if (timer === undefined) timer = setInterval(refresh, intervalMs);
  } else {
    await halt();
  }
  return { stop: () => halt() };
}
