import { PlaywrightDocumentRenderer, type RendererOptions } from '@pospay/documents';
import { expect, it } from 'vitest';

import { trackDocumentStartup } from '../startup-session.ts';

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
