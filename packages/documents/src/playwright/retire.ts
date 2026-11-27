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

function armCancellableGrace(
  ms: number,
  sleep?: (ms: number) => Promise<void>,
): { done: Promise<void>; stop: () => void; cancel: () => void } {
  if (!(ms > 0)) {
    return { done: Promise.resolve(), stop: () => undefined, cancel: () => undefined };
  }
  let release: (() => void) | undefined;
  const woken = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timerGrace = sleep === undefined ? armGrace(ms) : { done: sleep(ms), stop: () => undefined };
  return {
    done: Promise.race([timerGrace.done.catch(() => undefined), woken]),
    stop: timerGrace.stop,
    cancel: () => {
      timerGrace.stop();
      release?.();
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

/** تنسيق قفل وقتل مشترك لنفس المتصفح عشان القتل ما يتكررش ومؤقت السماح يقف عند تأكيد الخروج. */
export interface BrowserShutdown {
  runClose(graceMs: number, sleep?: (ms: number) => Promise<void>): Promise<RetireResult>;
  kill(): Promise<void> | undefined;
}

function trackKillCall(
  browser: PdfBrowser,
  onConfirmed: () => void,
  onError: (err: unknown) => void,
): Promise<void> | undefined {
  if (typeof browser.kill !== 'function') {
    const err = new Error('DOCUMENT_BROWSER_KILL_UNSUPPORTED');
    onError(err);
    return Promise.reject(err);
  }
  try {
    const raw = browser.kill();
    if (raw === undefined) {
      onConfirmed();
      return undefined;
    }
    const tracked = Promise.resolve(raw).then(
      () => {
        onConfirmed();
      },
      (err: unknown) => {
        onError(err);
        throw err;
      },
    );
    tracked.catch(() => undefined);
    return tracked;
  } catch (error) {
    const err = error instanceof Error ? error : new Error('DOCUMENT_BROWSER_KILL_FAILED');
    onError(err);
    return Promise.reject(err);
  }
}

async function waitKillOutcome(
  closing: Promise<unknown>,
  killCall: Promise<void> | undefined,
): Promise<RetireResult> {
  // رفض close أو فشل القتل ما يثبتش خروج العملية، فانتظار الخروج يعتمد على حل close أو kill بس.
  const never = (): Promise<void> => new Promise<void>(() => undefined);
  const cleanClose = closing.then(() => undefined, never);
  const killExit = killCall === undefined ? Promise.resolve() : killCall.then(() => undefined, never);
  const exit = Promise.race([cleanClose, killExit]);
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

function safeCloseBrowser(browser: PdfBrowser, onFinished: () => void): Promise<unknown> {
  let closing: Promise<unknown>;
  try {
    closing = Promise.resolve(browser.close());
  } catch {
    closing = Promise.reject(new Error('close failed'));
  }
  void closing.then(onFinished, () => undefined);
  return closing;
}

async function waitCloseGrace(
  activeClose: Promise<unknown>,
  graceMs: number,
  sleep: ((ms: number) => Promise<void>) | undefined,
  onCancel: (cancel: (() => void) | null) => void,
): Promise<void> {
  const grace = armCancellableGrace(graceMs, sleep);
  onCancel(grace.cancel);
  const pending = activeClose.then(() => undefined, () => undefined);
  try {
    await Promise.race([pending, grace.done]).catch(() => undefined);
  } finally {
    onCancel(null);
    grace.stop();
  }
}

/** بيبني منسّق إغلاق وقتل واحد لنفس المتصفح يتشارك بين المُصيّر والعامل. */
export function createBrowserShutdown(browser: PdfBrowser): BrowserShutdown {
  let closing: Promise<unknown> | null = null;
  let closeFinished = false;
  let killAttempted = false;
  let killConfirmed = false;
  let killError: unknown;
  let killResult: Promise<void> | undefined;
  let cancelGrace: (() => void) | null = null;

  const ensureClosing = (): Promise<unknown> =>
    (closing ??= safeCloseBrowser(browser, () => {
      closeFinished = true;
    }));

  const invokeKill = (fromExternal: boolean): Promise<void> | undefined => {
    if (fromExternal) cancelGrace?.();
    if (closeFinished || killConfirmed) return undefined;
    if (killAttempted && (killError === undefined || !fromExternal)) {
      return killError === undefined ? killResult : Promise.reject(killError);
    }
    killAttempted = true;
    killError = undefined;
    killResult = trackKillCall(
      browser,
      () => {
        killConfirmed = true;
      },
      (err) => {
        killError = err;
      },
    );
    return killResult;
  };

  return {
    kill: () => invokeKill(true),
    runClose: async (graceMs, sleep) => {
      const activeClose = ensureClosing();
      if (!killAttempted) {
        await waitCloseGrace(activeClose, graceMs, sleep, (cancel) => {
          cancelGrace = cancel;
        });
      }
      if (closeFinished || killConfirmed) return { confirmed: true, exit: Promise.resolve() };
      const killCall = invokeKill(false);
      return killConfirmed ? { confirmed: true, exit: Promise.resolve() } : waitKillOutcome(activeClose, killCall);
    },
  };
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
export function dropRetiredBrowser(
  browser: PdfBrowser,
  graceMs: number,
  sleep?: (ms: number) => Promise<void>,
): Promise<RetireResult> {
  return createBrowserShutdown(browser).runClose(graceMs, sleep);
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
