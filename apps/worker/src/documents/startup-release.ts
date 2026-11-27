import type { DocumentRenderer } from '@pospay/documents';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { RendererLiveness } from './liveness.ts';

export interface LiveQueue {
  worker: Worker;
  connection: Redis;
  liveness?: RendererLiveness;
}

/** طابور اتبنى ولسه مستنّى Redis. المهلة بتقفله قبل ما يبقى live. */
export interface HeldQueue {
  worker: Worker;
  connection: Redis;
}

export interface ReleaseSlot {
  renderer?: DocumentRenderer | undefined;
  live?: LiveQueue | undefined;
  queue?: HeldQueue | undefined;
  queueStopped?: boolean | undefined;
}

/** نتيجة قفل متصفح المحاولة: هل اتأكد خروج العملية، ووعد ينتهي لما القفل أو القتل يثبت. */
export interface RendererCloseOutcome {
  readonly confirmed: boolean;
  readonly exit: Promise<void>;
}

/** مهلة تفريغ الطابور في الإغلاق الطبيعي تغطّي حد الوظيفة (30 ثانية) مع كتابة الحالة. */
export const DRAIN_GRACE_MS = 35_000;

const KILL_WAIT_MS = 500;

export function waitForGrace(ms: number): { done: Promise<void>; stop: () => void } {
  if (!(ms > 0)) return { done: Promise.resolve(), stop: () => undefined };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

async function closeHeld(worker: Worker, connection: Redis, force: boolean): Promise<void> {
  await worker.close(force).catch(() => undefined);
  connection.disconnect();
}

async function killAndTrackExit(
  renderer: DocumentRenderer,
  closing: Promise<unknown>,
): Promise<RendererCloseOutcome> {
  const never = (): Promise<void> => new Promise<void>(() => undefined);
  const cleanClose = closing.then(() => undefined, never);
  let killCall: unknown;
  let killFailed = typeof renderer.kill !== 'function';
  if (!killFailed) {
    try {
      killCall = renderer.kill?.();
    } catch {
      killFailed = true;
    }
  }
  if (!killFailed && killCall === undefined) return { confirmed: true, exit: Promise.resolve() };
  const killClean = killFailed
    ? never()
    : Promise.resolve(killCall).then(
        () => undefined,
        () => never(),
      );
  const exit = Promise.race([cleanClose, killClean]);
  let resolved = false;
  const confirmed = exit.then(() => {
    resolved = true;
  });
  const grace = waitForGrace(KILL_WAIT_MS);
  try {
    await Promise.race([confirmed, grace.done]);
  } finally {
    grace.stop();
  }
  return { confirmed: resolved, exit };
}

/**
 * بيقفل المتصفح جوّه مهلة السماح، وبيقتله إلا لو close خلّص.
 * يرجّع تأكيد الخروج ووعد الاستكمال عشان المحاولة الجاية ما تفتحش متصفح تاني فوق القديم.
 */
export async function closeRendererWithinGrace(
  renderer: DocumentRenderer,
  graceMs: number,
): Promise<RendererCloseOutcome> {
  let closeResolved = false;
  let closing: Promise<unknown>;
  try {
    closing = Promise.resolve(renderer.close());
  } catch (error) {
    closing = Promise.reject(error);
  }
  const pending = closing.then(
    () => {
      closeResolved = true;
    },
    () => undefined,
  );
  const grace = waitForGrace(graceMs);
  try {
    await Promise.race([pending, grace.done]);
  } finally {
    grace.stop();
  }
  if (closeResolved) return { confirmed: true, exit: Promise.resolve() };
  return killAndTrackExit(renderer, closing);
}

async function releaseQueue(
  live: LiveQueue | undefined,
  queue: HeldQueue | undefined,
  queueStopped: boolean,
): Promise<void> {
  if (live !== undefined) {
    await live.liveness?.stop().catch(() => undefined);
    // لو stop() قفل الطابور بالفعل (خصوصاً force=true مع وظيفة معلّقة)، ما نندهش pause(false) عشان whenCurrentJobsFinished ما يعلّقش.
    if (!queueStopped && typeof live.worker.pause === 'function') {
      await live.worker.pause(false).catch(() => undefined);
    }
    await closeHeld(live.worker, live.connection, true);
    return;
  }
  if (queue !== undefined) {
    // لسه مش جاهز وماسكش وظيفة، فالقوة بتقطع إعادة اتصال Redis
    await closeHeld(queue.worker, queue.connection, true);
  }
}

async function boundedQueueRelease(
  live: LiveQueue | undefined,
  queue: HeldQueue | undefined,
  graceMs: number,
  queueStopped: boolean,
): Promise<void> {
  if (live === undefined && queue === undefined) return;
  let completed = false;
  const releasing = releaseQueue(live, queue, queueStopped)
    .then(() => {
      completed = true;
    })
    .catch(() => undefined);
  const grace = waitForGrace(graceMs);
  await Promise.race([releasing, grace.done]);
  grace.stop();
  if (completed) return;
  // القفل خلص مهلته فبنفصل اتصال Redis ونبعت قفل إجباري بدل ما يفضل يعيد الاتصال.
  if (live !== undefined) {
    void live.worker.close(true).catch(() => undefined);
    live.connection.disconnect();
  } else if (queue !== undefined) {
    void queue.worker.close(true).catch(() => undefined);
    queue.connection.disconnect();
  }
}

/** يفرّغ الطابور ويقفل متصفح المحاولة جوّه مهلتهما ويرجع تأكيد خروج المتصفح. */
export async function releaseStartupSlot(
  slot: ReleaseSlot,
  graceMs: number,
  boundQueue = false,
  drainGraceMs = graceMs,
): Promise<RendererCloseOutcome> {
  const live = slot.live;
  const queue = slot.queue;
  const renderer = slot.renderer;
  const queueStopped = slot.queueStopped === true;
  slot.live = undefined;
  slot.queue = undefined;
  slot.renderer = undefined;
  const confirmed: RendererCloseOutcome = { confirmed: true, exit: Promise.resolve() };
  if (boundQueue) {
    // تنظيف المحاولة الفاشلة بالتوازي وبحدّ مهلة عشان الإعادة الجاية ما تتأخرش.
    const [, rendererOutcome] = await Promise.all([
      boundedQueueRelease(live, queue, graceMs, queueStopped),
      renderer === undefined ? Promise.resolve(confirmed) : closeRendererWithinGrace(renderer, graceMs),
    ]);
    return rendererOutcome;
  }
  // الإغلاق الطبيعي بيدي تفريغ الطابور مهلة تغطّي حد الوظيفة، وبعدين يقفل Chromium بمهلة القفل.
  await boundedQueueRelease(live, queue, drainGraceMs, queueStopped);
  if (renderer === undefined) return confirmed;
  return closeRendererWithinGrace(renderer, graceMs);
}
