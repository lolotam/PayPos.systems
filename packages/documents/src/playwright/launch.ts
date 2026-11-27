import type { PdfBrowser } from './browser.ts';
import { dropRetiredBrowser } from './retire.ts';

type LaunchOutcome =
  | { readonly kind: 'browser'; readonly browser: PdfBrowser }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled'; readonly settled: Promise<void> };

/**
 * إطلاق المتصفح بمهلة. إطلاق معلّق بيتحسب فشل، والوعد المتروك بيتبلع جوّه:
 * رفض متأخر ما يبقاش رفض غير متعامل، ومتصفح وصل بعد المهلة بيتقفل بدل ما يبقى بلا حد.
 * إشارة الإيقاف بتلغي الإطلاق: المؤقّت بيتشال والمتصفح اللي يوصل بعدين بيتقفل.
 */
export async function launchWithinTimeout(
  launching: Promise<PdfBrowser>,
  timeoutMs: number,
  graceMs: number,
  signal?: AbortSignal,
): Promise<LaunchOutcome> {
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const guarded: Promise<LaunchOutcome> = launching.then(
    async (browser) => {
      if (!abandoned) return { kind: 'browser', browser } as const;
      await closeOrKill(browser, graceMs).catch(() => undefined);
      return { kind: 'cancelled', settled: Promise.resolve() } as const;
    },
    (error: unknown) => ({ kind: 'error', error }) as const,
  );
  const settled = guarded.then(
    () => undefined,
    () => undefined,
  );
  const expiry = new Promise<LaunchOutcome>((resolve) => {
    timer = setTimeout(() => {
      abandoned = true;
      resolve({ kind: 'timeout' });
    }, timeoutMs);
    if (signal === undefined) return;
    const cancel = (): void => {
      abandoned = true;
      if (timer !== undefined) clearTimeout(timer);
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
  return outcome;
}

/**
 * يقفل المتصفح جوّه المهلة، وبيقتله إلا لو close خلّص في وقتها.
 * بتستخدمه للمتصفح اللي وصل متأخر وللإغلاق الأخير.
 */
export async function closeOrKill(browser: PdfBrowser, graceMs: number): Promise<void> {
  await dropRetiredBrowser(browser, graceMs);
}
