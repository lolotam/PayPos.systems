import { expect, it } from 'vitest';

import { DocumentRenderTimeoutError } from '../domain/errors.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage } from '../playwright/browser.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';

const HTML = '<p>x</p>';
const PDF_TIMEOUT_MS = 30;
const OVERALL_TIMEOUT_MS = 500;
const CLOSE_GRACE_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface Scene {
  readonly renderer: PlaywrightDocumentRenderer;
  readonly kills: () => number;
}

function hangingPage(): PdfPage {
  return {
    setContent: async () => undefined,
    evaluate: async () => undefined,
    pdf: () => new Promise<Uint8Array>(() => undefined),
    close: () => new Promise<void>(() => undefined),
  };
}

/**
 * صفحة الطباعة بتعلّق، وقفل الصفحة بيعلّق معاها. قفل السياق بيتقفل أو لأ حسب `contextClose`.
 */
function sceneWith(contextClose: () => Promise<void>): Scene {
  let kills = 0;
  const context: PdfContext = {
    route: async () => undefined,
    newPage: async () => hangingPage(),
    close: () => contextClose(),
  };
  const factory: PdfBrowserFactory = {
    launch: async () => {
      const browser: PdfBrowser = {
        newContext: async () => context,
        close: () => new Promise<void>(() => undefined),
        kill: () => {
          kills += 1;
        },
        on: () => undefined,
      };
      return browser;
    },
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory,
    sleep,
    backoffMs: [0],
    pdfTimeoutMs: PDF_TIMEOUT_MS,
    overallTimeoutMs: OVERALL_TIMEOUT_MS,
    browserCloseGraceMs: CLOSE_GRACE_MS,
    closeGraceMs: CLOSE_GRACE_MS,
  });
  return { renderer, kills: () => kills };
}

it('does not wait for a hanging page close after the print deadline', async () => {
  const scene = sceneWith(async () => undefined);
  try {
    await scene.renderer.start();
    const started = Date.now();
    await expect(scene.renderer.render(HTML)).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(PDF_TIMEOUT_MS - 15);
    expect(elapsed).toBeLessThan(OVERALL_TIMEOUT_MS - 100);
    expect(scene.renderer.isAvailable()).toBe(true);
    expect(scene.kills()).toBe(0);
  } finally {
    await scene.renderer.close();
  }
});

it('retires the browser when the context close hangs after the print deadline', async () => {
  const scene = sceneWith(() => new Promise<void>(() => undefined));
  try {
    await scene.renderer.start();
    const started = Date.now();
    await expect(scene.renderer.render(HTML)).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(PDF_TIMEOUT_MS + CLOSE_GRACE_MS - 15);
    expect(elapsed).toBeLessThan(OVERALL_TIMEOUT_MS - 100);
    const deadline = Date.now() + 1_000;
    while (scene.kills() === 0 && Date.now() < deadline) {
      await sleep(5);
    }
    expect(scene.kills()).toBe(1);
  } finally {
    await scene.renderer.close();
  }
});

it('reuses a single context.close() promise so overall-deadline cleanup still retires on a hung first close', async () => {
  let closeCalls = 0;
  let kills = 0;
  const page: PdfPage = {
    setContent: async () => undefined,
    evaluate: async () => undefined,
    pdf: async () => {
      await sleep(10);
      return Uint8Array.from([1, 2, 3]);
    },
    close: async () => undefined,
  };
  const context: PdfContext = {
    route: async () => undefined,
    newPage: async () => page,
    close: () => {
      closeCalls += 1;
      if (closeCalls === 1) return new Promise<void>(() => undefined);
      return Promise.resolve();
    },
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: async () => context,
        close: () => new Promise<void>(() => undefined),
        kill: () => {
          kills += 1;
        },
        on: () => undefined,
      }),
    },
    sleep,
    backoffMs: [0],
    pdfTimeoutMs: 500,
    overallTimeoutMs: 40,
    browserCloseGraceMs: CLOSE_GRACE_MS,
    closeGraceMs: CLOSE_GRACE_MS,
  });
  try {
    await renderer.start();
    await expect(renderer.render(HTML)).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
    const deadline = Date.now() + 1_000;
    while (kills === 0 && Date.now() < deadline) {
      await sleep(5);
    }
    expect(closeCalls).toBe(1);
    expect(kills).toBe(1);
  } finally {
    await renderer.close();
  }
});

it('keeps DocumentRenderTimeoutError when page.close() throws synchronously after print timeout', async () => {
  let kills = 0;
  const page: PdfPage = {
    setContent: async () => undefined,
    evaluate: async () => undefined,
    pdf: () => new Promise<Uint8Array>(() => undefined),
    close: () => {
      throw new Error('page close crashed');
    },
  };
  const context: PdfContext = {
    route: async () => undefined,
    newPage: async () => page,
    close: async () => undefined,
  };
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: async () => context,
        close: async () => undefined,
        kill: () => {
          kills += 1;
        },
        on: () => undefined,
      }),
    },
    sleep,
    backoffMs: [0],
    pdfTimeoutMs: PDF_TIMEOUT_MS,
    overallTimeoutMs: OVERALL_TIMEOUT_MS,
    browserCloseGraceMs: CLOSE_GRACE_MS,
    closeGraceMs: CLOSE_GRACE_MS,
  });
  await renderer.start();
  await expect(renderer.render(HTML)).rejects.toBeInstanceOf(DocumentRenderTimeoutError);
  expect(kills).toBe(0);
  await renderer.close();
});
