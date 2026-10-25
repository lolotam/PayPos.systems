import { afterEach, expect, it, vi } from 'vitest';

import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage } from '../playwright/browser.ts';
import { launchWithinTimeout } from '../playwright/launch.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

afterEach(() => {
  vi.useRealTimers();
});

function page(pdf: PdfPage['pdf']): PdfPage {
  return {
    setContent: async () => undefined,
    evaluate: async () => undefined,
    pdf,
    close: async () => undefined,
  };
}

function context(pdf: PdfPage['pdf'], onRoute?: PdfContext['route']): PdfContext {
  return {
    route: onRoute ?? (async () => undefined),
    newPage: async () => page(pdf),
    close: async () => undefined,
  };
}

function browser(
  pdf: PdfPage['pdf'],
  hooks?: { onClose?: () => void; route?: PdfContext['route'] },
): PdfBrowser {
  const listeners: Array<() => void> = [];
  return {
    newContext: async () => context(pdf, hooks?.route),
    close: async () => hooks?.onClose?.(),
    on: (_event, listener) => listeners.push(listener),
  };
}

async function untilAvailable(renderer: PlaywrightDocumentRenderer): Promise<void> {
  for (let attempt = 0; attempt < 20 && !renderer.isAvailable(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('relaunches after a launch that never settles', async () => {
  let launches = 0;
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      if (launches === 1) return new Promise<PdfBrowser>(() => undefined);
      return browser(async () => Uint8Array.from([1]));
    },
  };
  const errors: unknown[] = [];
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    launchTimeoutMs: 20,
    backoffMs: [0],
    sleep: async () => undefined,
    onLaunchError: (error) => errors.push(error),
  });
  await renderer.start();
  await untilAvailable(renderer);
  expect(errors).toHaveLength(1);
  expect(renderer.isAvailable()).toBe(true);
  expect(launches).toBe(2);
  await renderer.close();
});

it('closes a browser that arrives after the launch timeout', async () => {
  let launches = 0;
  let release: (browser: PdfBrowser) => void = () => undefined;
  const late = new Promise<PdfBrowser>((resolve) => {
    release = resolve;
  });
  let browserClosed = false;
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      if (launches === 1) return late;
      return new Promise<PdfBrowser>(() => undefined);
    },
  };
  const errors: unknown[] = [];
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    launchTimeoutMs: 20,
    backoffMs: [0],
    sleep: async () => undefined,
    onLaunchError: (error) => errors.push(error),
  });
  await renderer.start();
  expect(errors).toHaveLength(1);
  release(
    browser(async () => Uint8Array.from([1]), {
      onClose: () => {
        browserClosed = true;
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(browserClosed).toBe(true);
  expect(renderer.isAvailable()).toBe(false);
  await renderer.close();
});

it('cancels a hung launch when the renderer closes', async () => {
  let launches = 0;
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      return new Promise<PdfBrowser>(() => undefined);
    },
  };
  const renderer = new PlaywrightDocumentRenderer({ factory, launchTimeoutMs: 30_000 });
  const starting = renderer.start();
  await renderer.close();
  await starting;
  expect(launches).toBe(1);
});

it('cancels a launch when the signal aborts', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const launching = launchWithinTimeout(
    new Promise<PdfBrowser>(() => undefined),
    30_000,
    1_000,
    controller.signal,
  );
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  const outcome = await launching;
  expect(outcome.kind).toBe('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

async function lateBrowserKills(close: PdfBrowser['close']): Promise<number> {
  let launches = 0;
  let kills = 0;
  let release: (browser: PdfBrowser) => void = () => undefined;
  const late = new Promise<PdfBrowser>((resolve) => {
    release = resolve;
  });
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      if (launches === 1) return late;
      return new Promise<PdfBrowser>(() => undefined);
    },
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    launchTimeoutMs: 20,
    closeGraceMs: 20,
    backoffMs: [0],
    sleep: async () => undefined,
  });
  await renderer.start();
  release({
    newContext: async () => context(async () => Uint8Array.from([1])),
    close,
    kill: () => {
      kills += 1;
    },
    on: () => undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await renderer.close();
  return kills;
}

it('kills a late browser whose close never finishes', async () => {
  let launches = 0;
  let kills = 0;
  let release: (browser: PdfBrowser) => void = () => undefined;
  const late = new Promise<PdfBrowser>((resolve) => {
    release = resolve;
  });
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      if (launches === 1) return late;
      return new Promise<PdfBrowser>(() => undefined);
    },
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    launchTimeoutMs: 20,
    closeGraceMs: 20,
    backoffMs: [0],
    sleep: async () => undefined,
  });
  await renderer.start();
  release({
    newContext: async () => context(async () => Uint8Array.from([1])),
    close: () => new Promise<void>(() => undefined),
    kill: () => {
      kills += 1;
    },
    on: () => undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(kills).toBe(1);
  await renderer.close();
});

it('kills a late browser whose close rejects', async () => {
  const kills = await lateBrowserKills(() => Promise.reject(new Error('close failed')));
  expect(kills).toBe(1);
});

it('kills a late browser whose close throws', async () => {
  const kills = await lateBrowserKills(() => {
    throw new Error('close failed');
  });
  expect(kills).toBe(1);
});

it('does not kill a late browser whose close finishes', async () => {
  const kills = await lateBrowserKills(async () => undefined);
  expect(kills).toBe(0);
});
