import type { PdfBrowser } from './browser.ts';
import { getLaunchCleanup, getLaunchCleanupRetry } from './process-tree.ts';
import {
  createBrowserShutdown,
  dropRetiredBrowser,
  type BrowserShutdown,
  type RetireResult,
} from './retire.ts';

export { createBrowserShutdown, type BrowserShutdown };

type LaunchOutcome =
  | { readonly kind: 'browser'; readonly browser: PdfBrowser }
  | { readonly kind: 'error'; readonly error: unknown; readonly cleanup: Promise<void> | undefined }
  | { readonly kind: 'timeout'; readonly settled: Promise<void> }
  | { readonly kind: 'cancelled'; readonly settled: Promise<void> };

/** يبني بوابة تنظيف إطلاق فاشل تفضل مقفولة لو القتل فشل وتسمح بإعادة المحاولة عبر `BrowserShutdown`. */
export function resolveLaunchCleanupGate(
  error: unknown,
  onCleanupError?: (err: unknown) => void,
  onShutdown?: (shutdown: BrowserShutdown, retryGate: Promise<void> | undefined) => void,
  onConfirmed?: (shutdown: BrowserShutdown) => void,
  shouldEscalateImmediately?: () => boolean,
): Promise<void> | undefined {
  const cleanup = getLaunchCleanup(error);
  if (cleanup === undefined) return undefined;
  const retry = getLaunchCleanupRetry(error);
  const shutdown = createBrowserShutdown({
    newContext: () => Promise.reject(new Error('DOCUMENT_LAUNCH_FAILED')),
    close: () => Promise.reject(new Error('DOCUMENT_LAUNCH_FAILED')),
    kill: () => (retry !== undefined ? retry() : cleanup),
    on: () => undefined,
  });
  let settled = false;
  const fromCleanup = cleanup.then(
    () => undefined,
    (cleanupErr: unknown) => {
      if (!settled) onCleanupError?.(cleanupErr);
      if (retry !== undefined && (shouldEscalateImmediately?.() ?? false)) {
        void shutdown.kill()?.catch((err: unknown) => {
          if (!settled) onCleanupError?.(err);
        });
      }
      return shutdown.confirmed;
    },
  );
  const gate = Promise.race([fromCleanup, shutdown.confirmed]).then(() => {
    settled = true;
    onConfirmed?.(shutdown);
  });
  onShutdown?.(shutdown, retry !== undefined ? gate : undefined);
  return gate;
}

/** يقفل المتصفح المتقاعد ويستنى تأكيد خروج عمليته لو المهلة خلصت قبل التأكيد. */
export function waitRetiredExit(browser: PdfBrowser, graceMs: number): Promise<void> {
  return dropRetiredBrowser(browser, graceMs)
    .then((outcome) => (outcome.confirmed ? undefined : outcome.exit))
    .catch(() => undefined);
}

function armLaunchExpiry(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  settled: Promise<void>,
  onTriggered: () => void,
): { promise: Promise<LaunchOutcome>; disarm: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<LaunchOutcome>((resolve) => {
    const trigger = (kind: 'timeout' | 'cancelled'): void => {
      if (timer !== undefined) clearTimeout(timer);
      onTriggered();
      resolve({ kind, settled });
    };
    timer = setTimeout(() => trigger('timeout'), timeoutMs);
    if (signal === undefined) return;
    if (signal.aborted) return trigger('cancelled');
    onAbort = () => trigger('cancelled');
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    disarm: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * إطلاق المتصفح بمهلة. إطلاق معلّق بيتحسب فشل، والوعد المتروك بيتبلع جوّه:
 * رفض متأخر ما يبقاش رفض غير متعامل، ومتصفح وصل بعد المهلة أو الإلغاء بيتقفل قبل فكّ الحارس.
 * إشارة الإيقاف بتلغي الإطلاق: المؤقّت بيتشال والمتصفح اللي يوصل قبلها في نفس الدورة أو بعدها بيتقفل.
 */
export async function launchWithinTimeout(
  launching: Promise<PdfBrowser>,
  timeoutMs: number,
  graceMs: number,
  signal?: AbortSignal,
  closeLate?: (browser: PdfBrowser) => Promise<void>,
  cleanupForError?: (error: unknown) => Promise<void> | undefined,
): Promise<LaunchOutcome> {
  let cancelled = false;
  let landedBrowser: PdfBrowser | undefined;
  let cleanup: Promise<void> | undefined;
  const closeOnce = (browser: PdfBrowser): Promise<void> =>
    (cleanup ??= (closeLate ?? ((late) => waitRetiredExit(late, graceMs)))(browser));
  const guarded: Promise<LaunchOutcome> = launching.then(
    (browser) => {
      landedBrowser = browser;
      if (!cancelled && !(signal?.aborted ?? false)) return { kind: 'browser', browser } as const;
      return closeOnce(browser).then(() => ({ kind: 'cancelled', settled: Promise.resolve() }) as const);
    },
    (error: unknown) => {
      const gate = cleanupForError !== undefined ? cleanupForError(error) : resolveLaunchCleanupGate(error);
      if (gate !== undefined) cleanup ??= gate;
      return { kind: 'error', error, cleanup: gate } as const;
    },
  );
  const settled = guarded.then(() => cleanup ?? Promise.resolve(), () => cleanup ?? Promise.resolve());
  const expiry = armLaunchExpiry(timeoutMs, signal, settled, () => {
    cancelled = true;
    if (landedBrowser !== undefined) void closeOnce(landedBrowser);
  });
  try {
    const outcome = await Promise.race([guarded, expiry.promise]);
    if (outcome.kind === 'browser' && (cancelled || (signal?.aborted ?? false))) {
      return { kind: 'cancelled', settled: closeOnce(outcome.browser) };
    }
    return outcome;
  } finally {
    expiry.disarm();
  }
}

/**
 * يقفل المتصفح جوّه المهلة، وبيقتله إلا لو close خلّص في وقتها.
 * بتستخدمه للمتصفح اللي وصل متأخر وللإغلاق الأخير.
 */
export async function closeOrKill(browser: PdfBrowser, graceMs: number): Promise<RetireResult> {
  return dropRetiredBrowser(browser, graceMs);
}

/** يستنى بوّابة التقاعد أو الإلغاء، ويفك الانتظار فوراً لو إشارة البدء أو الإغلاق اتلغت. */
export function waitGate(
  gate: Promise<void> | null,
  signal?: AbortSignal,
  closeSignal?: AbortSignal,
): Promise<void> {
  if (gate === null || signal?.aborted || closeSignal?.aborted) return Promise.resolve();
  if (signal === undefined && closeSignal === undefined) return gate;
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', finish);
      closeSignal?.removeEventListener('abort', finish);
      resolve();
    };
    signal?.addEventListener('abort', finish, { once: true });
    closeSignal?.addEventListener('abort', finish, { once: true });
    void gate.then(finish, finish);
  });
}

/** يعيد محاولة قتل المتصفح المعلّق بتدرّج التراجع لحد ما بوابة الخروج تتأكد أو الإغلاق يبدأ. */
export async function driveShutdownRetries(
  gate: Promise<void>,
  getShutdown: () => BrowserShutdown | null,
  backoff: readonly number[],
  sleep: (ms: number) => Promise<void>,
  closeSignal: AbortSignal,
  onError?: (err: unknown) => void,
): Promise<void> {
  const gateAbort = new AbortController();
  const stop = (): void => gateAbort.abort();
  void gate.then(stop, stop);
  let attempts = 0;
  let shutdownBudget = 2;
  while (!gateAbort.signal.aborted && (!closeSignal.aborted || shutdownBudget > 0)) {
    const postClose = closeSignal.aborted;
    if (postClose) shutdownBudget -= 1;
    const delayMs = backoff[Math.min(attempts, backoff.length - 1)] ?? 0;
    attempts += 1;
    let floorTimer: ReturnType<typeof setTimeout> | undefined;
    const floor = new Promise<void>((resolve) => {
      floorTimer = setTimeout(resolve, Math.max(delayMs, 5));
      floorTimer.unref?.();
    });
    const safeSleep = delayMs > 0 && !postClose ? Promise.resolve().then(() => sleep(delayMs)).catch(() => undefined) : Promise.resolve();
    const pause = Promise.all([safeSleep, floor]).then(() => undefined);
    await waitGate(pause, gateAbort.signal, postClose ? undefined : closeSignal);
    if (floorTimer !== undefined) clearTimeout(floorTimer);
    if (gateAbort.signal.aborted || (!postClose && closeSignal.aborted)) return;
    const shutdown = getShutdown();
    if (shutdown === null) return;
    const retry = shutdown.kill();
    if (retry === undefined) {
      await Promise.resolve();
      continue;
    }
    const attempt = retry.catch((err: unknown) => {
      if (err instanceof Error && err.message === 'DOCUMENT_BROWSER_KILL_UNSUPPORTED') {
        gateAbort.abort();
        return;
      }
      if (!gateAbort.signal.aborted) onError?.(err);
    });
    await waitGate(attempt, gateAbort.signal, postClose ? undefined : closeSignal);
  }
}

/** ينتظر انتهاء محاولة الإطلاق المشتركة أو إلغاء كل منتظريها بشكل مستقل لكل منادٍ. */
export interface SharedStart {
  readonly signal: AbortSignal;
  join(signal: AbortSignal | undefined): Promise<void>;
  finish(): boolean;
  resolveWaiters(): void;
}

/** يدير منتظري start() المتداخلين بحيث لا يلغي أحدهم إقلاع الآخر إذا بقى منتظر نشط. */
export function createSharedStart(onAllAborted: () => void): SharedStart {
  const active = new Set<symbol>();
  const cleanups: Array<() => void> = [];
  const abortController = new AbortController();
  let hasUnsigned = false;
  let finishShared!: () => void;
  const shared = new Promise<void>((resolve) => {
    finishShared = resolve;
  });
  return {
    signal: abortController.signal,
    join: (signal) => {
      if (signal === undefined) {
        hasUnsigned = true;
        return shared;
      }
      if (signal.aborted) return Promise.resolve();
      const id = Symbol('start-waiter');
      active.add(id);
      return new Promise<void>((resolve) => {
        const finish = (): void => {
          active.delete(id);
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = (): void => {
          finish();
          if (!hasUnsigned && active.size === 0) {
            abortController.abort();
            onAllAborted();
          }
        };
        cleanups.push(() => signal.removeEventListener('abort', onAbort));
        signal.addEventListener('abort', onAbort, { once: true });
        void shared.then(finish, finish);
      });
    },
    finish: () => {
      const stillWaited = hasUnsigned || active.size > 0;
      active.clear();
      while (cleanups.length > 0) cleanups.pop()?.();
      return stillWaited;
    },
    resolveWaiters: () => finishShared(),
  };
}

/** بيصعّد لو بوابة خروج المتصفح فضلت معلّقة بعد المهلة المحددة. */
export function watchUnconfirmedExit(
  gate: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): void {
  if (!(timeoutMs > 0)) return;
  const timer = setTimeout(onTimeout, timeoutMs);
  timer.unref?.();
  void gate.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
}
