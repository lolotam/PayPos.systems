import type { PdfBrowser, PdfContext } from './browser.ts';
import { closeHungContext, openWithinGrace } from './context-guards.ts';

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
 * حدود القفل الموقوت: مهلة السماح، والنوم المحقون، والإحالة للمتصفح المتقاعد.
 */
export interface RetireGuards {
  readonly graceMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly retire: (browser: PdfBrowser) => void;
}

/**
 * بيقفل المتصفح المتقاعد جوّه مهلة السماح، وبيقتله إلا لو close خلّص في وقتها.
 * القفل المعلّق بياخد المهلة وبس؛ العمليات القديمة ما بتتسيبش شغّالة.
 *
 * @param browser المتصفح اللي اتقاعد
 * @param graceMs مهلة السماح للقفل قبل القتل
 * @param sleep النوم المحقون الاختياري؛ لو غاب بنستعمل مؤقّت بيتصفّى بعد القفل
 * @returns بعد ما المتصفح يتقفل أو يتقتل
 */
export async function dropRetiredBrowser(
  browser: PdfBrowser,
  graceMs: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  let finished = false;
  let closing: Promise<unknown>;
  try {
    closing = browser.close();
  } catch {
    closing = Promise.reject(new Error('close failed'));
  }
  const pending = closing.then(
    () => {
      finished = true;
    },
    () => undefined,
  );
  const grace =
    sleep === undefined ? armGrace(graceMs) : { done: sleep(graceMs), stop: () => undefined };
  try {
    await Promise.race([pending, grace.done]).catch(() => undefined);
  } finally {
    grace.stop();
  }
  if (finished) return;
  try {
    await browser.kill?.();
  } catch {
    // إشارة القتل مش بتوقف إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
  }
}

/**
 * تنظيف ما بعد المهلة: السياق اللي اتقفل جوّه مهلة السماح يسيب المتصفح، واللي اتقفل
 * بعد ما خلص أو ما وصلش بيتقاعد. القفل المعلّق بيتقاعد من غير ما يستنى.
 *
 * @param context السياق اللي اتفتح، لو اتفتح
 * @param opening وعد فتح السياق، لو ما اتفتحش لسه
 * @param browser المتصفح صاحب السياق
 * @param guards حدود القفل الموقوت
 * @returns بعد ما المتصفح يبقى متقاعد أو يفضل سليم
 */
export async function closeAfterTimeout(
  context: PdfContext | undefined,
  opening: Promise<PdfContext>,
  browser: PdfBrowser,
  guards: RetireGuards,
): Promise<void> {
  const late =
    context === undefined
      ? await openWithinGrace(opening, guards.graceMs, guards.sleep)
      : { settled: true, context };
  if (late.context !== undefined) {
    const hung = await closeHungContext(late.context, guards.graceMs, guards.sleep);
    if (hung) guards.retire(browser);
    return;
  }
  if (!late.settled) guards.retire(browser);
}
