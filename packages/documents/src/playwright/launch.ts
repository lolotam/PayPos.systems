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
  | { readonly kind: 'timeout' };

/**
 * إطلاق المتصفح بمهلة. إطلاق معلّق بيتحسب فشل، والوعد المتروك بيتبلع جوّه:
 * رفض متأخر ما يبقاش رفض غير متعامل، ومتصفح وصل بعد المهلة بيتقفل بدل ما يبقى بلا حد.
 */
export async function launchWithinTimeout(
  launching: Promise<PdfBrowser>,
  timeoutMs: number,
  graceMs: number,
): Promise<LaunchOutcome> {
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = launching.then(
    (browser) => {
      if (!abandoned) return { kind: 'browser', browser } as const;
      void closeLateBrowser(browser, graceMs);
      return { kind: 'timeout' } as const;
    },
    (error: unknown) => ({ kind: 'error', error }) as const,
  );
  const expiry = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      abandoned = true;
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });
  const outcome = await Promise.race([guarded, expiry]);
  if (timer !== undefined) clearTimeout(timer);
  return outcome;
}

/** متصفح وصل بعد مهلة الإطلاق؛ القفل المعلّق ما بيهمّ، فهو مش المتصفح الحالي. */
async function closeLateBrowser(browser: PdfBrowser, graceMs: number): Promise<void> {
  try {
    await finishWithinGrace(browser.close(), graceMs);
  } catch {
    // القفل الفاشل ما بيوقّفش إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
  }
}
