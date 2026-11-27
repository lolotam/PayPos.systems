import type { PdfBrowser } from './browser.ts';
import { dropRetiredBrowser } from './retire.ts';

type LaunchOutcome =
  | { readonly kind: 'browser'; readonly browser: PdfBrowser }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' };

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
  const guarded = launching.then(
    (browser) => {
      if (!abandoned) return { kind: 'browser', browser } as const;
      void closeOrKill(browser, graceMs);
      return { kind: 'cancelled' } as const;
    },
    (error: unknown) => ({ kind: 'error', error }) as const,
  );
  const expiry = new Promise<{ readonly kind: 'timeout' } | { readonly kind: 'cancelled' }>(
    (resolve) => {
      timer = setTimeout(() => {
        abandoned = true;
        resolve({ kind: 'timeout' });
      }, timeoutMs);
      if (signal === undefined) return;
      const cancel = (): void => {
        abandoned = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve({ kind: 'cancelled' });
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      onAbort = cancel;
      signal.addEventListener('abort', onAbort, { once: true });
    },
  );
  const outcome = await Promise.race([guarded, expiry]);
  if (timer !== undefined) clearTimeout(timer);
  if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  return outcome;
}

/**
 * يقفل المتصفح جوّه المهلة، وبيقتله إلا لو close خلّص في وقتها.
 * بتستخدمه للمتصفح اللي وصل متأخر وللإغلاق الأخير.
 */
export function closeOrKill(browser: PdfBrowser, graceMs: number): Promise<void> {
  return dropRetiredBrowser(browser, graceMs);
}
