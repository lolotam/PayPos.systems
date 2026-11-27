import type { DocumentRenderer } from '@pospay/documents';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { RendererLiveness } from './liveness.ts';

export interface LiveQueue {
  worker: Worker;
  connection: Redis;
  liveness?: RendererLiveness;
}

/** طابور اتبنى ولسه مستنّى Redis. المهلة بتقفله قبل ما يبقى live. */
export interface HeldQueue {
  worker: Worker;
  connection: Redis;
}

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
}

interface SessionState {
  generation: number;
  attempt: number;
  closed: boolean;
  accept: boolean;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  wake?: (() => void) | undefined;
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

async function closeHeld(worker: Worker, connection: Redis, force: boolean): Promise<void> {
  await worker.close(force).catch(() => undefined);
  connection.disconnect();
}

const KILL_WAIT_MS = 500;

async function waitForKill(killResult: void | Promise<void>): Promise<void> {
  if (killResult === undefined) return;
  const done = Promise.resolve(killResult).catch(() => undefined);
  const grace = waitForGrace(KILL_WAIT_MS);
  await Promise.race([done, grace.done]);
  grace.stop();
}

/**
 * بيقفل المتصفح جوّه مهلة السماح، وبيقتله إلا لو close خلّص.
 * القفل المعلّق ما بيأجلش المحاولة الجاية، والقتل هو اللي يفك Chromium المعلّق.
 */
async function closeRendererWithinGrace(renderer: DocumentRenderer, graceMs: number): Promise<void> {
  let finished = false;
  let closing: Promise<unknown>;
  try {
    closing = renderer.close();
  } catch {
    closing = Promise.reject(new Error('close failed'));
  }
  const pending = closing.then(
    () => {
      finished = true;
    },
    () => undefined,
  );
  const grace = waitForGrace(graceMs);
  await Promise.race([pending, grace.done]);
  grace.stop();
  // القفل اللي خلص في نفس اللحظة يبقى مغلوق، وما نقتلش متصفح سليم.
  await Promise.resolve();
  if (finished) return;
  try {
    await waitForKill(renderer.kill?.());
  } catch {
    // القتل اختياري؛ المحاولة الجاية ليها متصفح جديد.
  }
}

async function releaseQueue(
  live: LiveQueue | undefined,
  queue: HeldQueue | undefined,
): Promise<void> {
  if (live !== undefined) {
    await live.liveness?.stop().catch(() => undefined);
    await closeHeld(live.worker, live.connection, false);
    return;
  }
  if (queue !== undefined) {
    // لسه مش جاهز وماسكش وظيفة، فالقوة بتقطع إعادة اتصال Redis
    await closeHeld(queue.worker, queue.connection, true);
  }
}

async function boundedQueueRelease(
  live: LiveQueue | undefined,
  queue: HeldQueue | undefined,
  graceMs: number,
): Promise<void> {
  if (live === undefined && queue === undefined) return;
  let completed = false;
  const releasing = releaseQueue(live, queue)
    .then(() => {
      completed = true;
    })
    .catch(() => undefined);
  const grace = waitForGrace(graceMs);
  await Promise.race([releasing, grace.done]);
  grace.stop();
  if (completed) return;
  // القفل خلص مهلته فبنفصل اتصال Redis ونبعت قفل إجباري بدل ما يفضل يعيد الاتصال.
  if (live !== undefined) {
    void live.worker.close(true).catch(() => undefined);
    live.connection.disconnect();
  } else if (queue !== undefined) {
    void queue.worker.close(true).catch(() => undefined);
    queue.connection.disconnect();
  }
}

async function release(slot: Slot, graceMs: number, boundQueue = false): Promise<void> {
  const live = slot.live;
  const queue = slot.queue;
  const renderer = slot.renderer;
  slot.live = undefined;
  slot.queue = undefined;
  slot.renderer = undefined;
  if (boundQueue) {
    // تنظيف المحاولة الفاشلة بالتوازي وبحدّ مهلة عشان الإعادة الجاية ما تتأخرش.
    await Promise.all([
      boundedQueueRelease(live, queue, graceMs),
      renderer === undefined ? Promise.resolve() : closeRendererWithinGrace(renderer, graceMs),
    ]);
    return;
  }
  // الإغلاق الطبيعي يفرّغ الطابور الأول بحدّ مهلة عشان قفل Redis المعلّق ما يمنعش قفل Chromium.
  await boundedQueueRelease(live, queue, graceMs);
  if (renderer !== undefined) await closeRendererWithinGrace(renderer, graceMs);
}

function waitForGrace(ms: number): { done: Promise<void>; stop: () => void } {
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

/** متصفح وصل بعد إلغاء المحاولة. القفل متسقوف زي مهلة الإغلاق عشان close المعلّق ما يمسكش الإيقاف. */
function closeAbandoned(renderer: DocumentRenderer, graceMs: number): void {
  void closeRendererWithinGrace(renderer, graceMs);
}

function binder(state: SessionState, slot: Slot, graceMs: number): AttemptBinder {
  const cancelled = (): boolean => state.closed || !state.accept || slot.token !== state.generation;
  return {
    cancelled,
    signal: slot.controller.signal,
    setRenderer: (renderer) => {
      // التخزين بعد الإلغاء بيسيب متصفح من غير حد يقفله.
      if (cancelled()) {
        closeAbandoned(renderer, graceMs);
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
  // تنظيف الطابور ومتصفح المحاولة الفاشلة يشتغلوا بالتوازي؛ المتصفح بيتقتل جوّه مهلة السماح قبل أي إطلاق جديد.
  await release(slot, input.closeGraceMs ?? CLOSE_GRACE_MS, true);
  if (state.closed || !state.accept || input.stopped()) return;
  const last = input.retryDelaysMs.length - 1;
  const delay = input.retryDelaysMs[Math.min(state.attempt, last)] ?? 60_000;
  state.attempt += 1;
  await pause(state, delay, input.sleep);
  if (state.closed || !state.accept || input.stopped()) return;
  arm(state, input);
}

async function stopSession(state: SessionState, force: boolean): Promise<void> {
  state.accept = false;
  state.current.controller.abort();
  state.wake?.();
  const live = state.current.live;
  if (live === undefined) return;
  // المفتاح لو فضل بعد قفل المستهلك، الطلب الجاي هيلاقي متصفح من غير حد يستقبل.
  // Chromium بيفضل عشان الرندر الجاري، وبيتقفل آخر حاجة في close.
  await live.liveness?.stop().catch(() => undefined);
  await live.worker.close(force).catch(() => undefined);
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
  await release(state.current, input.closeGraceMs ?? CLOSE_GRACE_MS);
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
    stop: (force = false) => stopSession(state, force),
    close: () => closeSession(state, input),
  };
}
