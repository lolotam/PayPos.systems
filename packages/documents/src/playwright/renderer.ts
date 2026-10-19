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
const CONTEXT = { javaScriptEnabled: false, offline: true, serviceWorkers: 'block' } as const;

export interface RendererOptions {
  readonly factory?: PdfBrowserFactory;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMs?: readonly number[];
  readonly contentTimeoutMs?: number;
  readonly pdfTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
  readonly browserCloseGraceMs?: number;
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
  if (error instanceof Error && error.name === 'TimeoutError') return new DocumentRenderTimeoutError();
  if (error instanceof Error) return error;
  return new Error('DOCUMENT_RENDER_FAILED');
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
  await sleep(graceMs);
  if (!finished) await browser?.close().catch(() => undefined);
  await Promise.race([closing, sleep(0)]);
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
  readonly #onLaunchError: ((error: unknown) => void) | undefined;
  readonly #onDocumentHtml: ((outerHtml: string) => void) | undefined;
  #browser: PdfBrowser | null = null;
  #available = false;
  #closing = false;
  #relaunching: Promise<void> | null = null;
  #unavailable: Array<() => void> = [];
  #availableListeners: Array<() => void> = [];
  #aborted: string[] = [];

  constructor(options: RendererOptions = {}) {
    this.#factory = options.factory ?? playwrightFactory();
    this.#sleep = options.sleep ?? delay;
    this.#backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.#contentTimeoutMs = options.contentTimeoutMs ?? 10_000;
    this.#pdfTimeoutMs = options.pdfTimeoutMs ?? 20_000;
    this.#overallTimeoutMs = options.overallTimeoutMs ?? 30_000;
    this.#browserCloseGraceMs = options.browserCloseGraceMs ?? 1_000;
    this.#onLaunchError = options.onLaunchError;
    this.#onDocumentHtml = options.onDocumentHtml;
  }

  /** طلبات آخر رندر اللي الـ route لغاها. مش بتتسجل. */
  takeAbortedRequests(): readonly string[] {
    return [...this.#aborted];
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
    this.#markUnavailable();
    const browser = this.#browser;
    this.#browser = null;
    await browser?.close().catch(() => undefined);
  }

  async render(html: string, options?: RenderOptions): Promise<Uint8Array> {
    assertHtmlWithinLimit(html);
    const browser = this.#browser;
    if (!this.#available || browser === null) throw new DocumentRendererUnavailableError();
    const context = await browser.newContext(CONTEXT);
    this.#aborted = [];
    try {
      return await this.#renderBounded(context, browser, html, options?.signal);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async #launchOnce(): Promise<void> {
    try {
      const browser = await this.#factory.launch();
      if (this.#closing) {
        await browser.close().catch(() => undefined);
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
    for (const listener of this.#availableListeners) listener();
  }

  #markUnavailable(): void {
    const wasAvailable = this.#available;
    this.#available = false;
    if (!wasAvailable) return;
    for (const listener of this.#unavailable) listener();
  }

  #scheduleRelaunch(): void {
    if (this.#closing || this.#relaunching !== null) return;
    this.#relaunching = this.#relaunchLoop().finally(() => {
      this.#relaunching = null;
      if (!this.#closing && !this.#available) this.#scheduleRelaunch();
    });
  }

  async #relaunchLoop(): Promise<void> {
    for (let attempt = 0; !this.#closing && !this.#available; attempt += 1) {
      const delayMs = this.#backoff[Math.min(attempt, this.#backoff.length - 1)] ?? 0;
      await this.#sleep(delayMs);
      if (this.#closing) return;
      await this.#launchOnce();
    }
  }

  async #renderBounded(
    context: PdfContext,
    browser: PdfBrowser,
    html: string,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    try {
      const pdf = await this.#deadline(context, html, signal);
      return assertPdfWithinLimit(pdf);
    } catch (error) {
      const mapped = asRendererError(error);
      if (mapped instanceof DocumentRenderTimeoutError) {
        await closeHungContext(context, browser, this.#browserCloseGraceMs, this.#sleep);
      }
      throw mapped;
    }
  }

  #deadline(context: PdfContext, html: string, signal: AbortSignal | undefined): Promise<Uint8Array> {
    const hooks = this.#hooks();
    const work = renderPage(
      context,
      html,
      { contentMs: this.#contentTimeoutMs, pdfMs: this.#pdfTimeoutMs },
      hooks,
    );
    return raceDeadline(work, this.#overallTimeoutMs, signal);
  }

  #hooks(): RenderPageHooks {
    return {
      onAbort: (url) => {
        this.#aborted.push(url);
      },
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
