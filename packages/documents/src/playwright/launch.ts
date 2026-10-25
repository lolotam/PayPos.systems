import type { PdfBrowser } from './browser.ts';

function armGrace(ms: number): { done: Promise<void>; stop: () => void } {
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

/**
 * بروتوكول Chromium المعلّق ما يمسكش المستدعي.
 * المؤقّت مش sleep بتاع إعادة الإطلاق، عشان الإغلاق ما يطولش التأخير.
 * القفل نفسه بيفضل شغال بعد المهلة لحد ما يخلّص أو يقع.
 */
export async function finishWithinGrace(work: Promise<unknown>, graceMs: number): Promise<void> {
  let finished = false;
  const pending = work.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  const grace = armGrace(graceMs);
  try {
    await Promise.race([pending, grace.done]);
  } finally {
    grace.stop();
  }
  if (!finished) void pending;
}

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
      void closeLateBrowser(browser, graceMs);
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

/** متصفح وصل بعد مهلة الإطلاق؛ القفل المعلّق ما بيهمّ، فهو مش المتصفح الحالي. */
async function closeLateBrowser(browser: PdfBrowser, graceMs: number): Promise<void> {
  let finished = false;
  let closing: Promise<unknown>;
  try {
    closing = browser.close();
  } catch {
    return;
  }
  const pending = closing.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  const grace = armGrace(graceMs);
  try {
    await Promise.race([pending, grace.done]);
  } finally {
    grace.stop();
  }
  if (finished) return;
  try {
    browser.kill?.();
  } catch {
    // إشارة القتل مش بتوقف إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
  }
}
