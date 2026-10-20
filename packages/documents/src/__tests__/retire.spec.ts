import { expect, it } from 'vitest';

import { DocumentRenderTimeoutError } from '../domain/errors.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage } from '../playwright/browser.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

const HTML = '<p>x</p>';
const OVERALL_MS = 40;

interface Gate {
  sleep(ms: number): Promise<void>;
  release(): void;
  releaseAll(): void;
  pending(): number;
}

interface Scene {
  renderer: PlaywrightDocumentRenderer;
  gate: Gate;
  launches(): number;
  kills(): number;
  browserCloses(): number;
  contextCloses(): number;
  unavailable(): number;
  emitDisconnected(): void;
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

function hangPage(): PdfPage {
  return {
    setContent: () => new Promise(() => undefined),
    evaluate: async () => undefined,
    pdf: async () => Uint8Array.from([1]),
    close: async () => undefined,
  };
}

function quietBrowser(): PdfBrowser {
  return {
    newContext: () => new Promise(() => undefined),
    close: async () => undefined,
    on: () => undefined,
  };
}

function rendererFor(factory: PdfBrowserFactory, gate: Gate): PlaywrightDocumentRenderer {
  return new PlaywrightDocumentRenderer({
    factory,
    sleep: (ms) => gate.sleep(ms),
    backoffMs: [0],
    overallTimeoutMs: OVERALL_MS,
    closeGraceMs: 30,
    stableForMs: 60_000,
  });
}

function sceneWith(first: PdfBrowser, emitDisconnected: () => void): Scene {
  const gate = sleepGate();
  let launches = 0;
  let unavailable = 0;
  const renderer = rendererFor(
    {
      launch: async () => {
        launches += 1;
        return launches === 1 ? first : quietBrowser();
      },
    },
    gate,
  );
  renderer.onUnavailable(() => {
    unavailable += 1;
  });
  return {
    renderer,
    gate,
    launches: () => launches,
    kills: () => 0,
    browserCloses: () => 0,
    contextCloses: () => 0,
    unavailable: () => unavailable,
    emitDisconnected,
  };
}

function wedgedNewContext(): Scene {
  let kills = 0;
  let browserCloses = 0;
  const listeners: Array<() => void> = [];
  const scene = sceneWith(
    {
      newContext: () => new Promise(() => undefined),
      close: () => {
        browserCloses += 1;
        return new Promise(() => undefined);
      },
      kill: () => {
        kills += 1;
      },
      on: (_event, listener) => {
        listeners.push(listener);
      },
    },
    () => {
      for (const listener of listeners) listener();
    },
  );
  return {
    ...scene,
    kills: () => kills,
    browserCloses: () => browserCloses,
  };
}

function contextScene(close: () => Promise<void>): Scene {
  let kills = 0;
  let browserCloses = 0;
  let contextCloses = 0;
  const context: PdfContext = {
    route: async () => undefined,
    newPage: async () => hangPage(),
    close: () => {
      contextCloses += 1;
      return close();
    },
  };
  const scene = sceneWith(
    {
      newContext: async () => context,
      close: () => {
        browserCloses += 1;
        return new Promise(() => undefined);
      },
      kill: () => {
        kills += 1;
      },
      on: () => undefined,
    },
    () => undefined,
  );
  return {
    ...scene,
    kills: () => kills,
    browserCloses: () => browserCloses,
    contextCloses: () => contextCloses,
  };
}

async function untilPending(gate: Gate, count: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (gate.pending() < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(gate.pending()).toBeGreaterThanOrEqual(count);
}

async function untilAvailable(renderer: PlaywrightDocumentRenderer): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!renderer.isAvailable() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(renderer.isAvailable()).toBe(true);
}

async function ticks(count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function rejectOnDeadline(scene: Scene): Promise<number> {
  const started = Date.now();
  let settled = false;
  const rendering = scene.renderer.render(HTML);
  void rendering.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await untilPending(scene.gate, 1);
  expect(settled).toBe(false);
  scene.gate.release();
  await expect(rendering).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  return Date.now() - started;
}

function expectWithinDeadline(elapsed: number): void {
  expect(elapsed).toBeGreaterThanOrEqual(OVERALL_MS - 25);
  expect(elapsed).toBeLessThan(1_000);
}

it('retires a browser whose newContext and close never settle', async () => {
  const scene = wedgedNewContext();
  try {
    await scene.renderer.start();
    expectWithinDeadline(await rejectOnDeadline(scene));
    expect(scene.renderer.isAvailable()).toBe(false);
    expect(scene.unavailable()).toBe(1);
    expect(scene.kills()).toBe(0);
    expect(scene.launches()).toBe(1);
    scene.gate.release();
    scene.gate.release();
    await untilAvailable(scene.renderer);
    expect(scene.kills()).toBe(1);
    expect(scene.launches()).toBe(2);
    const launches = scene.launches();
    scene.emitDisconnected();
    expect(scene.renderer.isAvailable()).toBe(true);
    expect(scene.launches()).toBe(launches);
  } finally {
    scene.gate.releaseAll();
    await scene.renderer.close();
  }
});

it('retires a browser whose context close never settles', async () => {
  const scene = contextScene(() => new Promise(() => undefined));
  try {
    await scene.renderer.start();
    expectWithinDeadline(await rejectOnDeadline(scene));
    expect(scene.contextCloses()).toBe(1);
    expect(scene.renderer.isAvailable()).toBe(false);
    expect(scene.unavailable()).toBe(1);
    expect(scene.kills()).toBe(0);
    expect(scene.launches()).toBe(1);
    scene.gate.release();
    scene.gate.release();
    await untilAvailable(scene.renderer);
    expect(scene.kills()).toBe(1);
    expect(scene.launches()).toBe(2);
  } finally {
    scene.gate.releaseAll();
    await scene.renderer.close();
  }
});

it('keeps the browser when the context closes within the grace', async () => {
  const scene = contextScene(async () => undefined);
  try {
    await scene.renderer.start();
    const started = Date.now();
    await expect(scene.renderer.render(HTML)).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
    expectWithinDeadline(Date.now() - started);
    expect(scene.contextCloses()).toBe(1);
    expect(scene.browserCloses()).toBe(0);
    expect(scene.kills()).toBe(0);
    expect(scene.launches()).toBe(1);
    expect(scene.renderer.isAvailable()).toBe(true);
  } finally {
    scene.gate.releaseAll();
    await scene.renderer.close();
  }
});

it('does not relaunch when close runs while retire is pending', async () => {
  const scene = wedgedNewContext();
  try {
    await scene.renderer.start();
    await rejectOnDeadline(scene);
    await scene.renderer.close();
    scene.gate.releaseAll();
    await ticks(5);
    expect(scene.launches()).toBe(1);
    expect(scene.renderer.isAvailable()).toBe(false);
  } finally {
    scene.gate.releaseAll();
    await scene.renderer.close();
  }
});
