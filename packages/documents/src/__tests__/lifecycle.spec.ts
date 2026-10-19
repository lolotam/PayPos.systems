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

function browser(pdf: PdfPage['pdf'], hooks?: { onClose?: () => void; route?: PdfContext['route'] }): PdfBrowser {
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
  await renderer.start();
  await renderer.render('<p>x</p>');
  expect(renderer.takeAbortedRequests()).toEqual(['https://example.invalid/pixel.png']);
  await renderer.close();
});
