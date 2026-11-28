import type { DocumentRenderer } from '@pospay/documents';

import type { RendererLiveness } from './liveness.ts';
import {
  closeRendererWithinGrace,
  DRAIN_GRACE_MS,
  releaseStartupSlot,
  waitForGrace,
  type HeldQueue,
  type LiveQueue,
  type RendererCloseOutcome,
} from './startup-release.ts';

export { DRAIN_GRACE_MS, type HeldQueue, type LiveQueue, type RendererCloseOutcome } from './startup-release.ts';

export interface AttemptBinder {
  cancelled(): boolean;
  /** إشارة بتقطع انتظار الإقلاع؛ الإيقاف أو فشل المحاولة بيوقظها. */
  readonly signal: AbortSignal;
  setRenderer(renderer: DocumentRenderer): void;
  setLive(live: LiveQueue): void;
  setLiveness(liveness: RendererLiveness): void;
  holdQueue(queue: HeldQueue): void;
}

interface Slot {
  token: number;
  controller: AbortController;
  renderer?: DocumentRenderer | undefined;
  live?: LiveQueue | undefined;
  queue?: HeldQueue | undefined;
  queueStopped?: boolean | undefined;
}

interface SessionState {
  generation: number;
  attempt: number;
  closed: boolean;
  accept: boolean;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  wake?: (() => void) | undefined;
  pendingExit?: Promise<void> | undefined;
  current: Slot;
  resolveStart: () => void;
}

const CLOSE_GRACE_MS = 5_000;

export interface StartupSessionInput {
  readonly startupMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly run: (attempt: AttemptBinder) => Promise<boolean>;
  readonly onFailed: (error: Error) => void;
  /** أقصى انتظار لتنظيف محاولة فاشلة قبل جدولة اللي بعدها. */
  readonly closeGraceMs?: number;
  /** مهلة تفريغ الطابور في الإغلاق الطبيعي قبل قفل BullMQ إجبارياً. */
  readonly drainGraceMs?: number;
}

export interface StartupSession {
  readonly started: Promise<void>;
  stop(force?: boolean): Promise<void>;
  close(): Promise<void>;
}

function succeed(state: SessionState): void {
  if (state.settled) return;
  state.settled = true;
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.resolveStart();
}

function trackPendingExit(state: SessionState, outcome: RendererCloseOutcome): void {
  if (outcome.confirmed) return;
  const prev = state.pendingExit;
  const next = prev === undefined ? outcome.exit : prev.then(() => outcome.exit);
  const wrapped = next.finally(() => {
    if (state.pendingExit === wrapped) state.pendingExit = undefined;
  });
  state.pendingExit = wrapped;
}

async function waitPendingExit(state: SessionState, stopped: () => boolean): Promise<void> {
  while (state.pendingExit !== undefined && !state.closed && state.accept && !stopped()) {
    const pending = state.pendingExit;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        if (state.wake === finish) state.wake = undefined;
        resolve();
      };
      state.wake = finish;
      void pending.then(finish, finish);
    });
  }
}

function pause(
  state: SessionState,
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (state.wake === finish) state.wake = undefined;
      resolve();
    };
    state.wake = finish;
    void sleep(ms).then(finish, finish);
  });
}

/** متصفح وصل بعد إلغاء المحاولة. القفل متسقوف وخروجه متسجل عشان المحاولة الجاية ما تفتحش فوقه. */
function closeAbandoned(state: SessionState, renderer: DocumentRenderer, graceMs: number): void {
  const tracked = closeRendererWithinGrace(renderer, graceMs).then((outcome) => {
    if (!outcome.confirmed) return outcome.exit;
    return undefined;
  });
  trackPendingExit(state, { confirmed: false, exit: tracked });
}

function binder(state: SessionState, slot: Slot, graceMs: number): AttemptBinder {
  const cancelled = (): boolean => state.closed || !state.accept || slot.token !== state.generation;
  return {
    cancelled,
    signal: slot.controller.signal,
    setRenderer: (renderer) => {
      // التخزين بعد الإلغاء بيسيب متصفح من غير حد يقفله.
      if (cancelled()) {
        closeAbandoned(state, renderer, graceMs);
        return;
      }
      slot.renderer = renderer;
    },
    setLive: (live) => {
      slot.live = live;
      slot.queue = undefined;
      if (state.timer !== undefined) clearTimeout(state.timer);
    },
    setLiveness: (liveness) => {
      if (cancelled() || slot.live === undefined) {
        void liveness.stop().catch(() => undefined);
        return;
      }
      slot.live.liveness = liveness;
    },
    holdQueue: (queue) => {
      slot.queue = queue;
    },
  };
}

function arm(state: SessionState, input: StartupSessionInput): void {
  const slot: Slot = { token: state.generation, controller: new AbortController() };
  state.current = slot;
  state.timer = setTimeout(() => {
    void fail(state, input, slot, new Error('DOCUMENT_START_TIMEOUT'));
  }, input.startupMs);
  void input.run(binder(state, slot, input.closeGraceMs ?? CLOSE_GRACE_MS)).then(
    (ready) => finishAttempt(state, input, slot, ready),
    (error: unknown) => {
      const wrapped = error instanceof Error ? error : new Error('DOCUMENT_START_FAILED');
      void fail(state, input, slot, wrapped);
    },
  );
}

function finishAttempt(
  state: SessionState,
  input: StartupSessionInput,
  slot: Slot,
  ready: boolean,
): void {
  if (state.closed || slot.token !== state.generation) return;
  if (state.timer !== undefined) clearTimeout(state.timer);
  if (ready || input.stopped() || !state.accept) {
    succeed(state);
    return;
  }
  void fail(state, input, slot, new Error('DOCUMENT_START_FAILED'));
}

async function fail(
  state: SessionState,
  input: StartupSessionInput,
  slot: Slot,
  error: Error,
): Promise<void> {
  if (state.closed || !state.accept || slot.token !== state.generation) return;
  state.generation += 1;
  slot.controller.abort();
  if (state.timer !== undefined) clearTimeout(state.timer);
  input.onFailed(error);
  // تنظيف الطابور ومتصفح المحاولة الفاشلة يشتغلوا بالتوازي؛ أي إطلاق جديد مستنّي تأكيد خروج القديم.
  trackPendingExit(
    state,
    await releaseStartupSlot(slot, input.closeGraceMs ?? CLOSE_GRACE_MS, true),
  );
  if (state.closed || !state.accept || input.stopped()) return;
  const last = input.retryDelaysMs.length - 1;
  const delay = input.retryDelaysMs[Math.min(state.attempt, last)] ?? 60_000;
  state.attempt += 1;
  await pause(state, delay, input.sleep);
  await waitPendingExit(state, input.stopped);
  if (state.closed || !state.accept || input.stopped()) return;
  arm(state, input);
}

async function stopSession(
  state: SessionState,
  input: StartupSessionInput,
  force: boolean,
): Promise<void> {
  state.accept = false;
  state.current.controller.abort();
  state.wake?.();
  const live = state.current.live;
  if (live === undefined) return;
  state.current.queueStopped = true;
  // المفتاح لو فضل بعد قفل المستهلك، الطلب الجاي هيلاقي متصفح من غير حد يستقبل.
  // Chromium بيفضل عشان الرندر الجاري، وبيتقفل آخر حاجة في close.
  await live.liveness?.stop().catch(() => undefined);
  if (force) {
    await live.worker.close(true).catch(() => undefined);
    return;
  }
  const drainGraceMs = input.drainGraceMs ?? input.closeGraceMs ?? DRAIN_GRACE_MS;
  let completed = false;
  const draining = (async () => {
    if (typeof live.worker.pause === 'function') {
      await live.worker.pause(false).catch(() => undefined);
    }
    await live.worker.close(true).catch(() => undefined);
    completed = true;
  })();
  const grace = waitForGrace(drainGraceMs);
  await Promise.race([draining, grace.done]);
  grace.stop();
  if (!completed) void live.worker.close(true).catch(() => undefined);
}

async function closeSession(state: SessionState, input: StartupSessionInput): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  state.accept = false;
  state.current.controller.abort();
  state.generation += 1;
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.wake?.();
  succeed(state);
  const closeGraceMs = input.closeGraceMs ?? CLOSE_GRACE_MS;
  await releaseStartupSlot(
    state.current,
    closeGraceMs,
    false,
    input.drainGraceMs ?? input.closeGraceMs ?? DRAIN_GRACE_MS,
  );
}

/** إقلاع القدرة. البطء والفشل بيتأجلوا؛ الإيقاف هو اللي بيقفل المحاولة نهائي. */
export function trackDocumentStartup(input: StartupSessionInput): StartupSession {
  let resolveStart: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    resolveStart = resolve;
  });
  const state: SessionState = {
    generation: 0,
    attempt: 0,
    closed: false,
    accept: true,
    settled: false,
    current: { token: 0, controller: new AbortController() },
    resolveStart,
  };
  arm(state, input);
  return {
    started,
    stop: (force = false) => stopSession(state, input, force),
    close: () => closeSession(state, input),
  };
}
