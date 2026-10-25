import type { DocumentRenderer } from '@pospay/documents';

/** حالة إقلاع المتصفح: خلص، فشل، ولا لسه معلّق. */
export type RendererStart = {
  readonly state: 'started' | 'failed' | 'pending';
  readonly error?: unknown;
};

/**
 * إقلاع المتصفح بمهلة واحدة، وإشارة الإيقاف بتقطع الانتظار.
 * نداء واحد بس؛ الرفض المتأخر بيتبلع جوّه عشان ما يبقاش رفض غير متعامل.
 */
export async function startWithin(
  renderer: Pick<DocumentRenderer, 'start'>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RendererStart> {
  const launched = Promise.resolve().then(() => renderer.start());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guarded = launched.then(
    () => ({ state: 'started' as const }),
    (error: unknown) => ({ state: 'failed' as const, error }),
  );
  const expiry = new Promise<{ readonly state: 'pending' }>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'pending' }), timeoutMs);
    if (signal.aborted) {
      resolve({ state: 'pending' });
      return;
    }
    onAbort = () => resolve({ state: 'pending' });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const outcome = await Promise.race([guarded, expiry]);
  if (timer !== undefined) clearTimeout(timer);
  if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  return outcome;
}

/**
 * انتظار بينتهي مع الوقت أو مع إشارة الإيقاف، أيّهما يجي الأول.
 * من غير sleep بيفضل مؤقّته؛ ومع sleep بيسبق بين الانتظار والإلغاء.
 */
export async function waitOrAbort(
  ms: number,
  signal: AbortSignal,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const waiting =
    sleep === undefined
      ? new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        })
      : sleep(ms);
  try {
    await Promise.race([waiting, aborted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}
