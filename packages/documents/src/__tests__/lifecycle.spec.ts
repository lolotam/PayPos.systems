import { expect, it } from 'vitest';

import { DocumentRenderTimeoutError } from '../domain/errors.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage } from '../playwright/browser.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

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

it('relaunches after the browser disconnects', async () => {
  let launches = 0;
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      if (launches === 1) throw new Error('missing');
      return browser(async () => Uint8Array.from([1]));
    },
  };
  const errors: unknown[] = [];
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    backoffMs: [0],
    onLaunchError: (error) => errors.push(error),
  });
  await renderer.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(errors).toHaveLength(1);
  expect(renderer.isAvailable()).toBe(true);
  expect(launches).toBe(2);
  await renderer.close();
  expect(renderer.isAvailable()).toBe(false);
});

it('closes a hung browser when the overall deadline fires', async () => {
  let browserClosed = false;
  let hungCalls = 0;
  let releaseContext: () => void = () => undefined;
  const hung = new Promise<void>((resolve) => {
    releaseContext = resolve;
  });
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: async () => ({
        route: async () => undefined,
        newPage: async () => page(() => new Promise(() => undefined)),
        close: () => {
          hungCalls += 1;
          return hungCalls === 1 ? hung : Promise.resolve();
        },
      }),
      close: async () => {
        browserClosed = true;
      },
      on: () => undefined,
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    overallTimeoutMs: 20,
    browserCloseGraceMs: 10,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(browserClosed).toBe(true);
  releaseContext();
  await renderer.close();
});

it('records urls aborted by the route handler', async () => {
  const factory: PdfBrowserFactory = {
    launch: async () =>
      browser(async () => Uint8Array.from([1]), {
        route: async (_pattern, handler) => {
          await handler({
            request: () => ({ url: () => 'https://example.invalid/pixel.png' }),
            abort: async () => undefined,
          });
        },
      }),
  };
  const renderer = new PlaywrightDocumentRenderer({ factory });
  const aborted: string[] = [];
  await renderer.start();
  await renderer.render('<p>x</p>', {
    onAbortedRequest: (url) => {
      aborted.push(url);
    },
  });
  expect(aborted).toEqual(['https://example.invalid/pixel.png']);
  await renderer.close();
});

async function untilAvailable(renderer: PlaywrightDocumentRenderer): Promise<void> {
  for (let attempt = 0; attempt < 20 && !renderer.isAvailable(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('recycles a browser whose newContext never settles', async () => {
  let launches = 0;
  let browserClosed = false;
  const factory: PdfBrowserFactory = {
    launch: async () => {
      launches += 1;
      const listeners: Array<() => void> = [];
      return {
        newContext: () => new Promise(() => undefined),
        close: async () => {
          browserClosed = true;
          for (const listener of listeners) listener();
        },
        on: (_event, listener) => {
          listeners.push(listener);
        },
      };
    },
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    overallTimeoutMs: 20,
    browserCloseGraceMs: 5,
    backoffMs: [0],
  });
  await renderer.start();
  const started = Date.now();
  await expect(renderer.render('<p>x</p>')).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(browserClosed).toBe(true);
  expect(renderer.isAvailable()).toBe(false);
  await untilAvailable(renderer);
  expect(launches).toBe(2);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('closes a context that arrives after an aborted signal', async () => {
  let browserClosed = false;
  let contextClosed = false;
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: async () => ({
        route: async () => undefined,
        newPage: async () => page(async () => Uint8Array.from([1])),
        close: async () => {
          contextClosed = true;
        },
      }),
      close: async () => {
        browserClosed = true;
      },
      on: () => undefined,
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    browserCloseGraceMs: 5_000,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
      }),
  });
  await renderer.start();
  const started = Date.now();
  await expect(renderer.render('<p>x</p>', { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
    DocumentRenderTimeoutError,
  );
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(contextClosed).toBe(true);
  expect(browserClosed).toBe(false);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('drops a late rejection when the signal is already aborted', async () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: () => Promise.reject(new Error('late context')),
      close: async () => undefined,
      on: () => undefined,
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({ factory });
  try {
    await renderer.start();
    await expect(
      renderer.render('<p>x</p>', { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejections).toEqual([]);
  } finally {
    process.off('unhandledRejection', onRejection);
    await renderer.close();
  }
});

it('does not close the browser when the context closes inside the grace', async () => {
  let browserClosed = false;
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: async () => ({
        route: async () => undefined,
        newPage: async () => ({
          setContent: () => new Promise<void>(() => undefined),
          evaluate: async () => undefined,
          pdf: async () => Uint8Array.from([1]),
          close: async () => undefined,
        }),
        close: async () => undefined,
      }),
      close: async () => {
        browserClosed = true;
      },
      on: () => undefined,
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    overallTimeoutMs: 20,
    browserCloseGraceMs: 5_000,
  });
  await renderer.start();
  const started = Date.now();
  await expect(renderer.render('<p>x</p>')).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(browserClosed).toBe(false);
  await renderer.close();
});

it('keeps growing the relaunch delay when Chromium dies on launch', async () => {
  const delays: number[] = [];
  let release: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: async () => context(async () => Uint8Array.from([1])),
      close: async () => undefined,
      on: (_event, listener) => {
        queueMicrotask(listener);
      },
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    backoffMs: [5, 15, 40],
    stableForMs: 60_000,
    sleep: async (ms) => {
      delays.push(ms);
      if (delays.length < 3) return;
      await renderer.close();
      release();
    },
  });
  await renderer.start();
  await stopped;
  expect(delays).toEqual([5, 15, 40]);
});

it('times out a hanging setContent inside the deadline', async () => {
  let contextClosed = false;
  const factory: PdfBrowserFactory = {
    launch: async () => ({
      newContext: async () => ({
        route: async () => undefined,
        newPage: async () => ({
          setContent: () => new Promise<void>(() => undefined),
          evaluate: async () => undefined,
          pdf: async () => Uint8Array.from([1]),
          close: async () => undefined,
        }),
        close: async () => {
          contextClosed = true;
        },
      }),
      close: async () => undefined,
      on: () => undefined,
    }),
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    overallTimeoutMs: 30,
    browserCloseGraceMs: 5,
  });
  await renderer.start();
  const started = Date.now();
  await expect(renderer.render('<p>x</p>')).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(contextClosed).toBe(true);
  await renderer.close();
});
