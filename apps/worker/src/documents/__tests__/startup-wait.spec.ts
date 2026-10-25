import { afterEach, expect, it, vi } from 'vitest';

import { startWithin, waitOrAbort } from '../startup-wait.ts';

afterEach(() => {
  vi.useRealTimers();
});

it('ends the wait when the signal aborts', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const waiting = waitOrAbort(60_000, controller.signal);
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  await waiting;
  expect(vi.getTimerCount()).toBe(0);
});

it('resolves pending when the renderer start is aborted', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const starting = startWithin(
    { start: () => new Promise<void>(() => undefined) },
    30_000,
    controller.signal,
  );
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  const outcome = await starting;
  expect(outcome.state).toBe('pending');
  expect(vi.getTimerCount()).toBe(0);
});

it('resolves started when the renderer starts', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const outcome = await startWithin({ start: async () => undefined }, 30_000, controller.signal);
  expect(outcome.state).toBe('started');
  expect(vi.getTimerCount()).toBe(0);
});

it('resolves failed when the renderer start rejects', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const error = new Error('boom');
  const outcome = await startWithin(
    { start: () => Promise.reject(error) },
    30_000,
    controller.signal,
  );
  expect(outcome.state).toBe('failed');
  expect(outcome.error).toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});
