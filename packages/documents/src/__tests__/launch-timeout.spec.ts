import { expect, it } from 'vitest';

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
