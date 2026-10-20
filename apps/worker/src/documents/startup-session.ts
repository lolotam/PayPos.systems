import type { DocumentRenderer } from '@pospay/documents';
import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import type { RendererLiveness } from './liveness.ts';

export interface LiveQueue {
  worker: Worker;
  connection: Redis;
  liveness: RendererLiveness;
}

/** طابور اتبنى ولسه مستنّى Redis. المهلة بتقفله قبل ما يبقى live. */
export interface HeldQueue {
  worker: Worker;
  connection: Redis;
}

export interface AttemptBinder {
  cancelled(): boolean;
  setRenderer(renderer: DocumentRenderer): void;
  setLive(live: LiveQueue): void;
  holdQueue(queue: HeldQueue): void;
}

interface Slot {
  token: number;
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

export interface StartupSessionInput {
  readonly startupMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly run: (attempt: AttemptBinder) => Promise<boolean>;
  readonly onFailed: (error: Error) => void;
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

async function release(slot: Slot): Promise<void> {
  const live = slot.live;
  const queue = slot.queue;
  const renderer = slot.renderer;
  slot.live = undefined;
  slot.queue = undefined;
  slot.renderer = undefined;
  if (live !== undefined) {
    await closeHeld(live.worker, live.connection, false);
    await live.liveness.stop().catch(() => undefined);
  } else if (queue !== undefined) {
    // لسه مش جاهز وماسكش وظيفة، فالقوة بتقطع إعادة اتصال Redis
    await closeHeld(queue.worker, queue.connection, true);
  }
  await renderer?.close().catch(() => undefined);
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

function binder(state: SessionState, slot: Slot): AttemptBinder {
  return {
    cancelled: () => state.closed || !state.accept || slot.token !== state.generation,
    setRenderer: (renderer) => {
      slot.renderer = renderer;
    },
    setLive: (live) => {
      slot.live = live;
      slot.queue = undefined;
    },
    holdQueue: (queue) => {
      slot.queue = queue;
    },
  };
}

function arm(state: SessionState, input: StartupSessionInput): void {
  const slot: Slot = { token: state.generation };
  state.current = slot;
  state.timer = setTimeout(() => {
    void fail(state, input, slot, new Error('DOCUMENT_START_TIMEOUT'));
  }, input.startupMs);
  void input.run(binder(state, slot)).then(
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
  if (state.timer !== undefined) clearTimeout(state.timer);
  input.onFailed(error);
  await release(slot);
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
  state.wake?.();
  await state.current.live?.worker.close(force).catch(() => undefined);
}

async function closeSession(state: SessionState): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  state.accept = false;
  state.generation += 1;
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.wake?.();
  succeed(state);
  await release(state.current);
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
    current: { token: 0 },
    resolveStart,
  };
  arm(state, input);
  return {
    started,
    stop: (force = false) => stopSession(state, force),
    close: () => closeSession(state),
  };
}
