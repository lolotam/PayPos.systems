import type { DocumentRenderer } from '@pospay/documents';
import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness } from '../liveness.ts';

class ToggleRenderer implements DocumentRenderer {
  available = true;
  readonly #up: Array<() => void> = [];
  readonly #down: Array<() => void> = [];

  async start(): Promise<void> {
    if (this.available) for (const listener of this.#up) listener();
  }

  async close(): Promise<void> {
    this.available = false;
    for (const listener of this.#down) listener();
  }

  isAvailable(): boolean {
    return this.available;
  }

  onUnavailable(listener: () => void): void {
    this.#down.push(listener);
  }

  onAvailable(listener: () => void): void {
    this.#up.push(listener);
  }

  async render(): Promise<Uint8Array> {
    return new Uint8Array();
  }
}

it('blocks superseded publisher interval writes while the replacement is temporarily unavailable', async () => {
  let stored: string | null = null;
  const redis = {
    status: 'ready',
    on() {
      return this;
    },
    off() {
      return this;
    },
    set: async (_key: string, value: string) => {
      stored = value;
      return 'OK';
    },
    del: async () => {
      stored = null;
      return 1;
    },
  } as unknown as Redis;
  const oldRenderer = new ToggleRenderer();
  const newRenderer = new ToggleRenderer();
  const liveOld = await startRendererLiveness({
    redis,
    renderer: oldRenderer,
    intervalMs: 10,
    readyTimeoutMs: 1_000,
  });
  const liveNew = await startRendererLiveness({
    redis,
    renderer: newRenderer,
    intervalMs: 60_000,
    readyTimeoutMs: 1_000,
  });
  await newRenderer.close();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(stored).toBeNull();
  newRenderer.available = true;
  await newRenderer.start();
  await new Promise((resolve) => setImmediate(resolve));
  expect(stored).toBe('1');
  await liveOld.stop();
  expect(stored).toBe('1');
  await liveNew.stop();
  expect(stored).toBeNull();
});

it('retains previous publisher ownership when a replacement fails readiness', async () => {
  let stored: string | null = null;
  let sets = 0;
  const status: { current: string } = { current: 'ready' };
  const redis = {
    get status() {
      return status.current;
    },
    on() {
      return this;
    },
    off() {
      return this;
    },
    set: async (_key: string, value: string) => {
      sets += 1;
      stored = value;
      return 'OK';
    },
    del: async () => {
      stored = null;
      return 1;
    },
  } as unknown as Redis;
  const prevRenderer = new ToggleRenderer();
  const prev = await startRendererLiveness({
    redis,
    renderer: prevRenderer,
    intervalMs: 15,
    readyTimeoutMs: 1_000,
  });
  status.current = 'end';
  await expect(
    startRendererLiveness({
      redis,
      renderer: new ToggleRenderer(),
      intervalMs: 15,
      readyTimeoutMs: 1_000,
    }),
  ).rejects.toThrow('redis ended');
  status.current = 'ready';
  const before = sets;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(sets).toBeGreaterThan(before);
  expect(stored).toBe('1');
  await prev.stop();
  expect(stored).toBeNull();
});

it('re-arms restored publisher when renderer recovers during a failing replacement readiness wait', async () => {
  let sets = 0;
  let releaseReady: (() => void) | undefined;
  const listeners = new Map<string, Array<() => void>>();
  let status = 'ready';
  const redis = {
    get status() {
      return status;
    },
    on(event: string, fn: () => void) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
      return this;
    },
    off() {
      return this;
    },
    set: async () => {
      sets += 1;
      return 'OK';
    },
    del: async () => 1,
  } as unknown as Redis;
  const renderer = new ToggleRenderer();
  renderer.available = false;
  const prev = await startRendererLiveness({ redis, renderer, intervalMs: 15, readyTimeoutMs: 1_000 });
  status = 'connect';
  const replacement = expect(
    startRendererLiveness({ redis, renderer, intervalMs: 15, readyTimeoutMs: 1_000 }),
  ).rejects.toThrow('redis ended');
  renderer.available = true;
  await renderer.start();
  await new Promise<void>((resolve) => {
    releaseReady = () => {
      status = 'end';
      for (const fn of listeners.get('end') ?? []) fn();
      resolve();
    };
    setImmediate(releaseReady);
  });
  await replacement;
  const before = sets;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(sets).toBeGreaterThan(before);
  await prev.stop();
});
