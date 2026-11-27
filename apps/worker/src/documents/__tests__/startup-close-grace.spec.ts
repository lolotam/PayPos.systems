import {
  PlaywrightDocumentRenderer,
  type DocumentRenderer,
  type RendererOptions,
} from '@pospay/documents';
import { expect, it } from 'vitest';

import { trackDocumentStartup } from '../startup-session.ts';
import { FakeRenderer } from './render-harness.ts';

const GRACE_MS = 80;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hangingFactory(mark: {
  launches: number;
  closeAt: number;
  secondLaunchAt: number;
}): NonNullable<RendererOptions['factory']> {
  return {
    launch: async () => {
      mark.launches += 1;
      if (mark.launches === 2) mark.secondLaunchAt = Date.now();
      return {
        newContext: () => new Promise(() => undefined),
        close: () => {
          if (mark.closeAt === 0) mark.closeAt = Date.now();
          return new Promise(() => undefined);
        },
        on: () => undefined,
      };
    },
  };
}

/** محوّل قفله معلّق؛ القتل هو الوحيد اللي يفكّه. */
function hangingRenderer(mark: { closes: number; kills: number }): DocumentRenderer {
  return {
    async start() {
      return undefined;
    },
    close: () => {
      mark.closes += 1;
      return new Promise<void>(() => undefined);
    },
    kill: () => {
      mark.kills += 1;
    },
    isAvailable: () => false,
    onUnavailable: () => undefined,
    onAvailable: () => undefined,
    async render() {
      return new Uint8Array();
    },
  };
}

it('schedules the next startup attempt when browser close never returns', async () => {
  const mark = { launches: 0, closeAt: 0, secondLaunchAt: 0 };
  let runs = 0;
  const session = trackDocumentStartup({
    startupMs: 300,
    closeGraceMs: GRACE_MS,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      runs += 1;
      const renderer = new PlaywrightDocumentRenderer({
        factory: hangingFactory(mark),
        closeGraceMs: GRACE_MS,
        sleep: wait,
      });
      attempt.setRenderer(renderer);
      await renderer.start();
      if (runs === 1) return new Promise<boolean>(() => undefined);
      return true;
    },
  });
  try {
    await session.started;
    expect(mark.launches).toBe(2);
    expect(mark.secondLaunchAt - mark.closeAt).toBeGreaterThanOrEqual(GRACE_MS - 25);
    expect(mark.secondLaunchAt - mark.closeAt).toBeLessThan(1_000);
  } finally {
    await session.close();
  }
});

it('closes a renderer that resolves after startup timed out', async () => {
  let resolveRenderer: (renderer: FakeRenderer) => void = () => undefined;
  const late = new Promise<FakeRenderer>((resolve) => {
    resolveRenderer = resolve;
  });
  const renderer = new FakeRenderer();
  let closes = 0;
  const originalClose = renderer.close.bind(renderer);
  renderer.close = async () => {
    closes += 1;
    await originalClose();
  };
  const session = trackDocumentStartup({
    startupMs: 40,
    closeGraceMs: 50,
    retryDelaysMs: [60_000],
    sleep: () => new Promise(() => undefined),
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempt.setRenderer(await late);
      return true;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    resolveRenderer(renderer);
    await new Promise((resolve) => setImmediate(resolve));
    expect(closes).toBe(1);
    expect(renderer.isAvailable()).toBe(false);
  } finally {
    await session.close();
  }
});

it('kills a hanging Chromium before the replacement startup attempt launches', async () => {
  const mark = { launches: 0, kills: 0, killAt: 0, secondLaunchAt: 0 };
  let runs = 0;
  const session = trackDocumentStartup({
    startupMs: 200,
    closeGraceMs: GRACE_MS,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      runs += 1;
      const renderer = new PlaywrightDocumentRenderer({
        factory: {
          launch: async () => {
            mark.launches += 1;
            if (mark.launches === 2) mark.secondLaunchAt = Date.now();
            return {
              newContext: () => new Promise(() => undefined),
              close: () => new Promise<void>(() => undefined),
              kill: () => {
                mark.kills += 1;
                mark.killAt = Date.now();
              },
              on: () => undefined,
            };
          },
        },
        // مهلة المتصفح أطول من مهلة الجلسة، عشان القتل يجي من مهلة الجلسة.
        closeGraceMs: 400,
        sleep: wait,
      });
      attempt.setRenderer(renderer);
      await renderer.start();
      if (runs === 1) return new Promise<boolean>(() => undefined);
      return true;
    },
  });
  try {
    await session.started;
    expect(mark.kills).toBe(1);
    expect(mark.killAt).toBeGreaterThan(0);
    expect(mark.secondLaunchAt).toBeGreaterThan(0);
    expect(mark.killAt).toBeLessThanOrEqual(mark.secondLaunchAt);
  } finally {
    await session.close();
  }
});

it('kills a renderer that arrives after the startup timeout', async () => {
  const mark = { closes: 0, kills: 0 };
  let resolveRenderer: (renderer: DocumentRenderer) => void = () => undefined;
  const late = new Promise<DocumentRenderer>((resolve) => {
    resolveRenderer = resolve;
  });
  const session = trackDocumentStartup({
    startupMs: 40,
    closeGraceMs: 50,
    retryDelaysMs: [60_000],
    sleep: () => new Promise(() => undefined),
    stopped: () => false,
    onFailed: () => undefined,
    run: async (attempt) => {
      attempt.setRenderer(await late);
      return true;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    resolveRenderer(hangingRenderer(mark));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mark.closes).toBe(1);
    expect(mark.kills).toBe(1);
  } finally {
    await session.close();
  }
});

it('kills a hanging renderer within grace even when a held queue close hangs in parallel', async () => {
  const events: string[] = [];
  let attempt = 0;
  const session = trackDocumentStartup({
    startupMs: 50,
    closeGraceMs: 40,
    retryDelaysMs: [0],
    sleep: wait,
    stopped: () => false,
    onFailed: () => undefined,
    run: async (binder) => {
      attempt += 1;
      if (attempt === 1) {
        binder.holdQueue({
          worker: { close: () => new Promise<void>(() => undefined) } as never,
          connection: { disconnect: () => undefined } as never,
        });
        binder.setRenderer({
          async start() {
            return undefined;
          },
          close: () => new Promise<void>(() => undefined),
          kill: () => {
            events.push('kill-1');
          },
          isAvailable: () => false,
          onUnavailable: () => undefined,
          onAvailable: () => undefined,
          async render() {
            return new Uint8Array();
          },
        });
        return false;
      }
      events.push('attempt-2');
      return true;
    },
  });
  try {
    await session.started;
    expect(events).toEqual(['kill-1', 'attempt-2']);
  } finally {
    await session.close();
  }
});
