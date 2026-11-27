import type { PdfBrowser } from './browser.ts';
import {
  createBrowserShutdown,
  dropRetiredBrowser,
  type BrowserShutdown,
  type RetireResult,
} from './retire.ts';

export { createBrowserShutdown, type BrowserShutdown };

type LaunchOutcome =
  | { readonly kind: 'browser'; readonly browser: PdfBrowser }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'timeout'; readonly settled: Promise<void> }
  | { readonly kind: 'cancelled'; readonly settled: Promise<void> };

/** يقفل المتصفح المتقاعد ويستنى تأكيد خروج عمليته لو المهلة خلصت قبل التأكيد. */
export function waitRetiredExit(browser: PdfBrowser, graceMs: number): Promise<void> {
  return dropRetiredBrowser(browser, graceMs)
    .then((outcome) => (outcome.confirmed ? undefined : outcome.exit))
    .catch(() => undefined);
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
): Promise<LaunchOutcome> {
  let cancelled = false;
  let landedBrowser: PdfBrowser | undefined;
  let cleanup: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const closeOnce = (browser: PdfBrowser): Promise<void> => {
    cleanup ??= (closeLate ?? ((late) => waitRetiredExit(late, graceMs)))(browser);
    return cleanup;
  };
  const guarded: Promise<LaunchOutcome> = launching.then(
    (browser) => {
      landedBrowser = browser;
      if (!cancelled && !(signal?.aborted ?? false)) {
        return { kind: 'browser', browser } as const;
      }
      return closeOnce(browser).then(
        () => ({ kind: 'cancelled', settled: Promise.resolve() }) as const,
      );
    },
    (error: unknown) => ({ kind: 'error', error }) as const,
  );
  const settled = guarded.then(
    () => cleanup ?? Promise.resolve(),
    () => cleanup ?? Promise.resolve(),
  );
  const expiry = new Promise<LaunchOutcome>((resolve) => {
    timer = setTimeout(() => {
      cancelled = true;
      if (landedBrowser !== undefined) void closeOnce(landedBrowser);
      resolve({ kind: 'timeout', settled });
    }, timeoutMs);
    if (signal === undefined) return;
    const cancel = (): void => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (landedBrowser !== undefined) void closeOnce(landedBrowser);
      resolve({ kind: 'cancelled', settled });
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    onAbort = cancel;
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const outcome = await Promise.race([guarded, expiry]);
  if (timer !== undefined) clearTimeout(timer);
  if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  if (outcome.kind === 'browser' && (cancelled || (signal?.aborted ?? false))) {
    return { kind: 'cancelled', settled: closeOnce(outcome.browser) };
  }
  return outcome;
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
