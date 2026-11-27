import type { PdfBrowser, PdfContext } from './browser.ts';
import { closeHungContext, openWithinGrace } from './context-guards.ts';

const KILL_WAIT_MS = 500;

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
 * نتيجة تقاعد المتصفح: هل اتأكد خروج العملية، ووعد ينتهي لما القفل أو القتل يثبت.
 */
export interface RetireResult {
  readonly confirmed: boolean;
  readonly exit: Promise<void>;
}

/**
 * بيقفل المتصفح المتقاعد جوّه مهلة السماح، وبيقتله إلا لو close خلّص في وقتها.
 * القفل المعلّق بياخد المهلة وبس؛ العمليات القديمة ما بتتسيبش شغّالة.
 *
 * @param browser المتصفح اللي اتقاعد
 * @param graceMs مهلة السماح للقفل قبل القتل
 * @param sleep النوم المحقون الاختياري؛ لو غاب بنستعمل مؤقّت بيتصفّى بعد القفل
 * @returns confirmed لو اتأكد خروج المتصفح، مع exit للاستكمال قبل إعادة الإطلاق لو اتأخر
 */
export async function dropRetiredBrowser(
  browser: PdfBrowser,
  graceMs: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<RetireResult> {
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
  if (finished) return { confirmed: true, exit: Promise.resolve() };
  let killCall: unknown;
  try {
    killCall = browser.kill?.();
  } catch {
    // إشارة القتل مش بتوقف إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
    return { confirmed: true, exit: Promise.resolve() };
  }
  if (killCall === undefined) return { confirmed: true, exit: Promise.resolve() };
  // رفض close ما يثبتش خروج العملية، فانتظار الخروج يعتمد على حل close أو kill بس.
  const cleanClose = closing.then(
    () => undefined,
    () => new Promise<void>(() => undefined),
  );
  const exit = Promise.race([
    cleanClose,
    Promise.resolve(killCall).then(
      () => undefined,
      () => undefined,
    ),
  ]);
  let settled = false;
  const confirmed = exit.then(() => {
    settled = true;
  });
  const killGrace = armGrace(KILL_WAIT_MS);
  try {
    await Promise.race([confirmed, killGrace.done]);
  } finally {
    killGrace.stop();
  }
  return { confirmed: settled, exit };
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
