import { DOCUMENT_RENDERER_ALIVE_KEY } from '@pospay/contracts';
import {
  DocumentRenderTimeoutError,
  PlaywrightDocumentRenderer,
  type RendererOptions,
} from '@pospay/documents';
import type { Redis } from 'ioredis';
import { expect, it } from 'vitest';

import { startRendererLiveness, type RendererLiveness } from '../liveness.ts';

const HTML = '<p>x</p>';
const OVERALL_MS = 40;

interface Gate {
  sleep(ms: number): Promise<void>;
  release(): void;
  releaseAll(): void;
  pending(): number;
}

function sleepGate(): Gate {
  const waiting: Array<() => void> = [];
  return {
    sleep: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
    release: () => {
      waiting.shift()?.();
    },
    releaseAll: () => {
      while (waiting.length > 0) waiting.shift()?.();
    },
    pending: () => waiting.length,
  };
}

function memoryRedis(): { redis: Redis; value(): string | null } {
  let stored: string | null = null;
  const redis = {
    status: 'ready',
    on() {
      return this;
    },
    off() {
      return this;
    },
    async set(key: string, value: string) {
      if (key === DOCUMENT_RENDERER_ALIVE_KEY) stored = value;
      return 'OK';
    },
    async del(key: string) {
      if (key === DOCUMENT_RENDERER_ALIVE_KEY) stored = null;
      return 1;
    },
    connect() {
      return Promise.resolve();
    },
  };
  return { redis: redis as unknown as Redis, value: () => stored };
}

function wedgedRenderer(): {
  renderer: PlaywrightDocumentRenderer;
  gate: Gate;
} {
  const gate = sleepGate();
  let launches = 0;
  const factory: NonNullable<RendererOptions['factory']> = {
    launch: async () => {
      launches += 1;
      if (launches > 1) {
        return {
          newContext: () => new Promise(() => undefined),
          close: async () => undefined,
          on: () => undefined,
        };
      }
      return {
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        kill: () => undefined,
        on: () => undefined,
      };
    },
  };
  return {
    gate,
    renderer: new PlaywrightDocumentRenderer({
      factory,
      sleep: (ms) => gate.sleep(ms),
      backoffMs: [0],
      overallTimeoutMs: OVERALL_MS,
      closeGraceMs: 30,
      stableForMs: 60_000,
    }),
  };
}

async function untilPending(gate: Gate): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (gate.pending() < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(gate.pending()).toBeGreaterThanOrEqual(1);
}

async function untilAvailable(renderer: PlaywrightDocumentRenderer): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!renderer.isAvailable() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function yieldNow(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function rejectOnDeadline(renderer: PlaywrightDocumentRenderer, gate: Gate): Promise<void> {
  let settled = false;
  const rendering = renderer.render(HTML);
  void rendering.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await untilPending(gate);
  expect(settled).toBe(false);
  gate.release();
  await expect(rendering).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(renderer.isAvailable()).toBe(false);
}

it('deletes the alive key when the browser is retired and republishes after relaunch', async () => {
  const box = memoryRedis();
  const scene = wedgedRenderer();
  let live: RendererLiveness | undefined;
  try {
    await scene.renderer.start();
    live = await startRendererLiveness({
      redis: box.redis,
      renderer: scene.renderer,
      intervalMs: 60_000,
    });
    expect(box.value()).toBe('1');
    await rejectOnDeadline(scene.renderer, scene.gate);
    await yieldNow();
    expect(box.value()).toBeNull();
    scene.gate.release();
    scene.gate.release();
    await untilAvailable(scene.renderer);
    await yieldNow();
    expect(box.value()).toBe('1');
    expect(scene.renderer.isAvailable()).toBe(true);
  } finally {
    scene.gate.releaseAll();
    await live?.stop();
    await scene.renderer.close();
  }
});
