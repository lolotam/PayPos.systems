import type { PdfBrowser, PdfContext } from './browser.ts';
import { closeHungContext, openWithinGrace } from './context-guards.ts';
import { hasUnconfirmedDescendants, unrefActiveProcessPolls } from './process-tree.ts';

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
  readonly confirmed: Promise<void>;
  runClose(graceMs: number, sleep?: (ms: number) => Promise<void>, requireKill?: boolean): Promise<RetireResult>;
  kill(): Promise<void> | undefined;
}

interface ShutdownState {
  readonly browser: PdfBrowser;
  closing: Promise<unknown> | null;
  closeFinished: boolean;
  killAttempted: boolean;
  killConfirmed: boolean;
  killFailed: boolean;
  descendantUnconfirmed: boolean;
  fallbackAttempted: boolean;
  killSeq: number;
  killError: unknown;
  killResult: Promise<void> | undefined;
  closeInFlight: Promise<RetireResult> | null;
  inFlightUsesSleep: boolean;
  readonly cancels: Set<() => void>;
  readonly confirmedPromise: Promise<void>;
  readonly releaseConfirmed: () => void;
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
        const normalized = err instanceof Error ? err : new Error('DOCUMENT_BROWSER_KILL_FAILED');
        onError(normalized);
        throw normalized;
      },
    );
    tracked.catch(() => undefined);
    Object.defineProperty(tracked, 'unref', { value: () => unrefActiveProcessPolls(), configurable: true });
    return tracked;
  } catch (error) {
    const err = error instanceof Error ? error : new Error('DOCUMENT_BROWSER_KILL_FAILED');
    onError(err);
    return Promise.reject(err);
  }
}

async function waitKillOutcome(
  state: ShutdownState,
  killCall: Promise<void> | undefined,
): Promise<RetireResult> {
  if (killCall === undefined || isShutdownConfirmed(state)) {
    markShutdownConfirmed(state, state.closeFinished);
    return { confirmed: true, exit: Promise.resolve() };
  }
  const settledAttempt = killCall.then(
    () => undefined,
    () => undefined,
  );
  const killGrace = armGrace(KILL_WAIT_MS);
  try {
    await Promise.race([state.confirmedPromise, settledAttempt, killGrace.done]);
  } finally {
    killGrace.stop();
  }
  const confirmed = isShutdownConfirmed(state);
  if (!confirmed) unrefActiveProcessPolls();
  return { confirmed, exit: confirmed ? Promise.resolve() : state.confirmedPromise };
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

function isShutdownConfirmed(state: ShutdownState): boolean {
  return (
    state.killConfirmed ||
    (state.closeFinished && !state.descendantUnconfirmed && (!state.killAttempted || state.killFailed))
  );
}

async function waitCloseGrace(
  activeClose: Promise<unknown>,
  graceMs: number,
  sleep: ((ms: number) => Promise<void>) | undefined,
  cancels: Set<() => void>,
  isKillActive: () => boolean,
): Promise<void> {
  const grace = armCancellableGrace(graceMs, sleep);
  cancels.add(grace.cancel);
  // لو القتل شغال، نجاح close() لوحده ما يفكش السماح؛ نصحى بدري بس لو close اترفض أو markShutdownConfirmed لغى المؤقت.
  const never = (): Promise<void> => new Promise<void>(() => undefined);
  const settled = activeClose.then(() => (isKillActive() ? never() : undefined), () => undefined);
  try {
    await Promise.race([settled, grace.done]).catch(() => undefined);
  } finally {
    cancels.delete(grace.cancel);
    grace.stop();
  }
}

const freshExternalKills = new WeakSet<Promise<void>>();

/** يتحقق إن كان وعد القتل الحالي محاولة خارجية جديدة لم تُحتسب بعد ضمن ميزانية الإغلاق. */
export function consumeFreshKill(attempt: Promise<void>): boolean {
  const fresh = freshExternalKills.has(attempt);
  freshExternalKills.delete(attempt);
  return fresh;
}

function markShutdownConfirmed(state: ShutdownState, fromClose: boolean): void {
  if (fromClose) state.closeFinished = true;
  else {
    state.killConfirmed = true;
    state.descendantUnconfirmed = false;
  }
  for (const cancel of state.cancels) cancel();
  state.cancels.clear();
  state.releaseConfirmed();
}

function ensureClosing(state: ShutdownState): Promise<unknown> {
  return (state.closing ??= safeCloseBrowser(state.browser, () => {
    state.closeFinished = true;
    if (isShutdownConfirmed(state)) {
      markShutdownConfirmed(state, true);
    }
  }));
}

function runKillAttempt(state: ShutdownState, fromExternal: boolean): Promise<void> | undefined {
  if (isShutdownConfirmed(state)) return undefined;
  if (state.killAttempted && !state.killFailed) return state.killResult;
  if (!fromExternal) {
    if (state.fallbackAttempted) return Promise.reject(state.killError);
    if (state.killAttempted) state.fallbackAttempted = true;
  }
  state.killAttempted = true;
  state.killFailed = false;
  state.killError = undefined;
  const seq = (state.killSeq += 1);
  let resolveShared!: () => void;
  let rejectShared!: (err: unknown) => void;
  const shared = new Promise<void>((resolve, reject) => {
    resolveShared = resolve;
    rejectShared = reject;
  });
  shared.catch(() => undefined);
  state.killResult = shared;
  const callResult = trackKillCall(
    state.browser,
    () => {
      if (state.killSeq === seq) markShutdownConfirmed(state, false);
      resolveShared();
    },
    (err) => {
      if (state.killSeq === seq) {
        state.killFailed = true;
        state.killError = err;
        if (hasUnconfirmedDescendants(err)) state.descendantUnconfirmed = true;
        if (state.closeFinished && !state.descendantUnconfirmed) markShutdownConfirmed(state, true);
      }
      rejectShared(err);
    },
  );
  if (callResult === undefined) {
    if (state.killResult === shared) state.killResult = undefined;
    resolveShared();
    return undefined;
  }
  if (fromExternal) freshExternalKills.add(shared);
  callResult.catch(() => undefined);
  return shared;
}

async function executeCloseAttempt(
  state: ShutdownState,
  graceMs: number,
  sleep?: (ms: number) => Promise<void>,
  skipGrace = false,
): Promise<RetireResult> {
  const skipWait = skipGrace && typeof state.browser.kill === 'function';
  if (skipWait) state.descendantUnconfirmed = true;
  const activeClose = ensureClosing(state);
  if (!skipWait && !isShutdownConfirmed(state)) {
    await waitCloseGrace(activeClose, graceMs, sleep, state.cancels, () => state.killAttempted && !state.killFailed);
  }
  if (isShutdownConfirmed(state)) return { confirmed: true, exit: Promise.resolve() };
  const killCall = runKillAttempt(state, false);
  return isShutdownConfirmed(state)
    ? { confirmed: true, exit: Promise.resolve() }
    : waitKillOutcome(state, killCall);
}

/** بيبني منسّق إغلاق وقتل واحد لنفس المتصفح يتشارك بين المُصيّر والعامل. */
export function createBrowserShutdown(browser: PdfBrowser, requireKill = false): BrowserShutdown {
  let releaseConfirmed!: () => void;
  const confirmed = new Promise<void>((resolve) => {
    releaseConfirmed = resolve;
  });
  const state: ShutdownState = {
    browser,
    closing: null,
    closeFinished: false,
    killAttempted: false,
    killConfirmed: false,
    killFailed: false,
    descendantUnconfirmed: requireKill && typeof browser.kill === 'function',
    fallbackAttempted: false,
    killSeq: 0,
    killError: undefined,
    killResult: undefined,
    closeInFlight: null,
    inFlightUsesSleep: false,
    cancels: new Set(),
    confirmedPromise: confirmed,
    releaseConfirmed,
  };
  return {
    confirmed,
    kill: () => runKillAttempt(state, true),
    runClose: (graceMs, sleep, skipGrace = false) => {
      const usesSleep = sleep !== undefined;
      if (skipGrace && typeof state.browser.kill === 'function') {
        state.descendantUnconfirmed = true;
        for (const cancel of state.cancels) cancel();
        state.cancels.clear();
      }
      if (state.closeInFlight !== null && state.inFlightUsesSleep === usesSleep) return state.closeInFlight;
      const run = executeCloseAttempt(state, graceMs, sleep, skipGrace).then((outcome) => {
        if (state.closeInFlight === run && !outcome.confirmed) {
          state.closeInFlight = null;
          state.fallbackAttempted = false;
        }
        return outcome;
      });
      if (state.closeInFlight === null) {
        state.closeInFlight = run;
        state.inFlightUsesSleep = usesSleep;
      }
      return run;
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
