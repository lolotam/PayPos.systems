import { assertHtmlWithinLimit, assertPdfWithinLimit } from '../domain/limits.ts';
import {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from '../domain/errors.ts';
import type { DocumentRenderer, RenderOptions } from '../ports/document-renderer.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext } from './browser.ts';
import { playwrightFactory } from './factory.ts';
import { renderPage, type RenderPageHooks } from './render-page.ts';

const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 5000] as const;
const CLOSE_GRACE_MS = 5_000;
const CONTEXT = { javaScriptEnabled: false, offline: true, serviceWorkers: 'block' } as const;

export interface RendererOptions {
  readonly factory?: PdfBrowserFactory;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMs?: readonly number[];
  readonly contentTimeoutMs?: number;
  readonly pdfTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
  readonly browserCloseGraceMs?: number;
  /** انتظار browser.close في الإغلاق المتعمد. بعد المهلة القفل يكمل في الخلفية. */
  readonly closeGraceMs?: number;
  /** التأخير بيرجع لأول درجة بعد ما المتصفح يفضل قائم المدة دي. */
  readonly stableForMs?: number;
  readonly onLaunchError?: (error: unknown) => void;
  /** لقطة DOM بعد التحميل. للاختبار؛ مش بتتسجل. */
  readonly onDocumentHtml?: (outerHtml: string) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRendererError(error: unknown): Error {
  if (error instanceof DocumentRenderTimeoutError) return error;
  if (error instanceof DocumentTooLargeError) return error;
  if (error instanceof DocumentRendererUnavailableError) return error;
  if (error instanceof Error && error.name === 'TimeoutError')
    return new DocumentRenderTimeoutError();
  if (error instanceof Error) return error;
  return new Error('DOCUMENT_RENDER_FAILED');
}

/**
 * newContext المعلّق بيسيب Chromium متعلم متاح، ومفتاح الحياة يفضل يعرضه.
 * لو السياق جه جوّه المهلة يتقفل لوحده؛ لو ما جاش المتصفح يتقفل عشان disconnected يعيد الإطلاق.
 */
async function openWithinGrace(
  opening: Promise<PdfContext>,
  graceMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ readonly settled: boolean; readonly context: PdfContext | undefined }> {
  let settled = false;
  let context: PdfContext | undefined;
  const pending = opening.then(
    (opened) => {
      settled = true;
      context = opened;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([pending, sleep(graceMs)]);
  return { settled, context };
}

async function closeHungContext(
  context: PdfContext,
  browser: PdfBrowser | null,
  graceMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let finished = false;
  const closing = context.close().then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  await Promise.race([closing, sleep(graceMs)]);
  if (!finished) await browser?.close().catch(() => undefined);
}

function armGrace(ms: number): { done: Promise<void>; stop: () => void } {
  if (!(ms > 0)) return { done: Promise.resolve(), stop: () => undefined };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/**
 * بروتوكول Chromium المعلّق ما يمسكش المستدعي.
 * المؤقّت مش sleep بتاع إعادة الإطلاق، عشان الإغلاق ما يطولش التأخير.
 * القفل نفسه بيفضل شغال بعد المهلة لحد ما يخلّص أو يقع.
 */
async function finishWithinGrace(work: Promise<unknown>, graceMs: number): Promise<void> {
  let finished = false;
  const pending = work.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  const grace = armGrace(graceMs);
  try {
    await Promise.race([pending, grace.done]);
  } finally {
    grace.stop();
  }
  if (!finished) void pending;
}

/**
 * Chromium واحد للعملية. كل رندر سياق جديد من غير جافاسكربت ومن غير شبكة.
 * سقوط المتصفح بيعيد الإطلاق بتأخير قابل للحقن؛ الإغلاق المتعمد ما بيعيدش الإطلاق.
 */
export class PlaywrightDocumentRenderer implements DocumentRenderer {
  readonly #factory: PdfBrowserFactory;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #backoff: readonly number[];
  readonly #contentTimeoutMs: number;
  readonly #pdfTimeoutMs: number;
  readonly #overallTimeoutMs: number;
  readonly #browserCloseGraceMs: number;
  readonly #closeGraceMs: number;
  readonly #stableForMs: number;
  readonly #onLaunchError: ((error: unknown) => void) | undefined;
  readonly #onDocumentHtml: ((outerHtml: string) => void) | undefined;
  #browser: PdfBrowser | null = null;
  #available = false;
  #closing = false;
  #launchFailures = 0;
  #stableTimer: ReturnType<typeof setTimeout> | undefined;
  #relaunching: Promise<void> | null = null;
  #unavailable: Array<() => void> = [];
  #availableListeners: Array<() => void> = [];

  constructor(options: RendererOptions = {}) {
    this.#factory = options.factory ?? playwrightFactory();
    this.#sleep = options.sleep ?? delay;
    this.#backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.#contentTimeoutMs = options.contentTimeoutMs ?? 10_000;
    this.#pdfTimeoutMs = options.pdfTimeoutMs ?? 20_000;
    this.#overallTimeoutMs = options.overallTimeoutMs ?? 30_000;
    this.#browserCloseGraceMs = options.browserCloseGraceMs ?? 1_000;
    this.#closeGraceMs = options.closeGraceMs ?? CLOSE_GRACE_MS;
    this.#stableForMs = options.stableForMs ?? 30_000;
    this.#onLaunchError = options.onLaunchError;
    this.#onDocumentHtml = options.onDocumentHtml;
  }

  isAvailable(): boolean {
    return this.#available;
  }

  onUnavailable(listener: () => void): void {
    this.#unavailable.push(listener);
  }

  onAvailable(listener: () => void): void {
    this.#availableListeners.push(listener);
  }

  async start(): Promise<void> {
    await this.#launchOnce();
    if (!this.#available) this.#scheduleRelaunch();
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#clearStable();
    this.#markUnavailable();
    const browser = this.#browser;
    this.#browser = null;
    if (browser === null) return;
    await finishWithinGrace(browser.close(), this.#closeGraceMs);
  }

  async render(html: string, options?: RenderOptions): Promise<Uint8Array> {
    assertHtmlWithinLimit(html);
    const browser = this.#browser;
    if (!this.#available || browser === null) throw new DocumentRendererUnavailableError();
    return this.#renderOnce(browser, html, options);
  }

  async #launchOnce(): Promise<void> {
    try {
      const browser = await this.#factory.launch();
      if (this.#closing) {
        await finishWithinGrace(browser.close(), this.#closeGraceMs);
        return;
      }
      this.#browser = browser;
      this.#attach(browser);
      this.#markAvailable();
    } catch (error) {
      this.#onLaunchError?.(error);
      this.#markUnavailable();
    }
  }

  #attach(browser: PdfBrowser): void {
    browser.on('disconnected', () => {
      if (this.#closing || this.#browser !== browser) return;
      this.#browser = null;
      this.#markUnavailable();
      this.#scheduleRelaunch();
    });
  }

  #markAvailable(): void {
    this.#available = true;
    this.#armStable();
    for (const listener of this.#availableListeners) listener();
  }

  #markUnavailable(): void {
    this.#clearStable();
    const wasAvailable = this.#available;
    this.#available = false;
    if (!wasAvailable) return;
    for (const listener of this.#unavailable) listener();
  }

  #armStable(): void {
    this.#clearStable();
    const timer = setTimeout(() => {
      if (this.#available && !this.#closing) this.#launchFailures = 0;
    }, this.#stableForMs);
    timer.unref();
    this.#stableTimer = timer;
  }

  #clearStable(): void {
    if (this.#stableTimer === undefined) return;
    clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
  }

  #scheduleRelaunch(): void {
    if (this.#closing || this.#relaunching !== null) return;
    this.#relaunching = this.#relaunchLoop().finally(() => {
      this.#relaunching = null;
      if (!this.#closing && !this.#available) this.#scheduleRelaunch();
    });
  }

  async #relaunchLoop(): Promise<void> {
    while (!this.#closing && !this.#available) {
      const index = Math.min(this.#launchFailures, this.#backoff.length - 1);
      const delayMs = this.#backoff[index] ?? 0;
      this.#launchFailures += 1;
      await this.#sleep(delayMs);
      if (this.#closing) return;
      await this.#launchOnce();
    }
  }

  async #renderOnce(
    browser: PdfBrowser,
    html: string,
    options: RenderOptions | undefined,
  ): Promise<Uint8Array> {
    let context: PdfContext | undefined;
    let abandoned = false;
    const opening = browser.newContext(CONTEXT);
    const work = opening.then(async (opened) => {
      if (abandoned) {
        await opened.close().catch(() => undefined);
        throw new DocumentRenderTimeoutError();
      }
      context = opened;
      try {
        const pdf = await renderPage(
          opened,
          html,
          { contentMs: this.#contentTimeoutMs, pdfMs: this.#pdfTimeoutMs },
          this.#hooks(options?.onAbortedRequest),
        );
        return assertPdfWithinLimit(pdf);
      } finally {
        await opened.close().catch(() => undefined);
      }
    });
    try {
      return await raceDeadline(work, this.#overallTimeoutMs, options?.signal);
    } catch (error) {
      abandoned = true;
      const mapped = asRendererError(error);
      if (mapped instanceof DocumentRenderTimeoutError) {
        await this.#closeAfterTimeout(context, opening, browser);
      }
      throw mapped;
    }
  }

  async #closeAfterTimeout(
    context: PdfContext | undefined,
    opening: Promise<PdfContext>,
    browser: PdfBrowser,
  ): Promise<void> {
    const late =
      context === undefined
        ? await openWithinGrace(opening, this.#browserCloseGraceMs, this.#sleep)
        : { settled: true, context };
    if (late.context !== undefined) {
      await closeHungContext(late.context, browser, this.#browserCloseGraceMs, this.#sleep);
      return;
    }
    if (!late.settled) await browser.close().catch(() => undefined);
  }

  #hooks(onAborted: RenderOptions['onAbortedRequest']): RenderPageHooks {
    return {
      onAbort: (url) => onAborted?.(url),
      ...(this.#onDocumentHtml === undefined ? {} : { onDocumentHtml: this.#onDocumentHtml }),
    };
  }
}

function raceDeadline(
  work: Promise<Uint8Array>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const raced = new Promise<Uint8Array>((resolve, reject) => {
    if (signal?.aborted === true) {
      work.catch(() => undefined);
      reject(new DocumentRenderTimeoutError());
      return;
    }
    timer = setTimeout(() => reject(new DocumentRenderTimeoutError()), ms);
    onAbort = () => reject(new DocumentRenderTimeoutError());
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject);
  });
  return raced.finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  });
}
