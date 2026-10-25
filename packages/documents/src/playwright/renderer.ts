import { assertHtmlWithinLimit, assertPdfWithinLimit } from '../domain/limits.ts';
import {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from '../domain/errors.ts';
import type { DocumentRenderer, RenderOptions } from '../ports/document-renderer.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext } from './browser.ts';
import { closeHungContext, openWithinGrace } from './context-guards.ts';
import { playwrightFactory } from './factory.ts';
import { closeOrKill, launchWithinTimeout } from './launch.ts';
import { renderPage, type RenderPageHooks } from './render-page.ts';

const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 5000] as const;
const CLOSE_GRACE_MS = 5_000;
const LAUNCH_TIMEOUT_MS = 40_000;
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
  /** مهلة إطلاق Chromium. الإطلاق المعلّق بيتحسب فشل وبعده بتتأجل إعادة المحاولة. */
  readonly launchTimeoutMs?: number;
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
 * close على البروتوكول المعلّق ما بيرجع. السباق على sleep المحقون، وبعد المهلة بنقتل العملية.
 * الرفض المتأخر بيترمى عشان مسار الرندر ما يستناش القفل.
 */
async function dropRetiredBrowser(
  browser: PdfBrowser,
  graceMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let finished = false;
  let closing: Promise<unknown>;
  try {
    closing = browser.close();
  } catch {
    closing = Promise.reject(new Error('close failed'));
  }
  const pending = closing.then(
    () => {
      finished = true;
    },
    () => undefined,
  );
  await Promise.race([pending, sleep(graceMs)]).catch(() => undefined);
  if (finished) return;
  try {
    browser.kill?.();
  } catch {
    // إشارة القتل مش بتوقف إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
  }
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
  readonly #launchTimeoutMs: number;
  readonly #stableForMs: number;
  readonly #onLaunchError: ((error: unknown) => void) | undefined;
  readonly #onDocumentHtml: ((outerHtml: string) => void) | undefined;
  #browser: PdfBrowser | null = null;
  #launchController: AbortController | null = null;
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
    this.#launchTimeoutMs = options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
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
    // الإطلاق المعلّق بيتلغي فورًا؛ المتصفح اللي يوصل بعدين بيتقفل في الكور.
    this.#launchController?.abort();
    this.#clearStable();
    this.#markUnavailable();
    const browser = this.#browser;
    this.#browser = null;
    if (browser === null) return;
    await closeOrKill(browser, this.#closeGraceMs);
  }

  async render(html: string, options?: RenderOptions): Promise<Uint8Array> {
    assertHtmlWithinLimit(html);
    const browser = this.#browser;
    if (!this.#available || browser === null) throw new DocumentRendererUnavailableError();
    return this.#renderOnce(browser, html, options);
  }

  async #launchOnce(): Promise<void> {
    const controller = new AbortController();
    this.#launchController = controller;
    try {
      const outcome = await launchWithinTimeout(
        this.#factory.launch(),
        this.#launchTimeoutMs,
        this.#closeGraceMs,
        controller.signal,
      );
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'timeout') {
        this.#onLaunchError?.(new Error('DOCUMENT_LAUNCH_TIMEOUT'));
        this.#markUnavailable();
        return;
      }
      if (outcome.kind === 'error') throw outcome.error;
      const browser = outcome.browser;
      if (this.#closing) {
        await closeOrKill(browser, this.#closeGraceMs);
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
    const print = new AbortController();
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
          {
            contentMs: this.#contentTimeoutMs,
            pdfMs: this.#pdfTimeoutMs,
            signal: print.signal,
          },
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
      // المهلة الكلية لو سبقت الطباعة بتقفل السياق هنا. نلغي مؤقّت الطباعة من غير رفض السباق
      // عشان page.pdf المعلّق ما يقفلش السياق مرة تانية وهو بيتقفل.
      print.abort();
      const mapped = asRendererError(error);
      if (mapped instanceof DocumentRenderTimeoutError) {
        await this.#closeAfterTimeout(context, opening, browser);
      }
      throw mapped;
    }
  }

  /**
   * الإتاحة لازم تسقط حتى لو close معلّق، وإلا مفتاح الحياة يفضل يعرض المتصفح المعلّق.
   * القفل مش بيتستناه؛ البروتوكول المعلّق ما بيرجّع close فبعد المهلة بنقتل العملية.
   */
  #retire(browser: PdfBrowser): void {
    if (this.#browser !== browser) return;
    this.#browser = null;
    this.#markUnavailable();
    this.#scheduleRelaunch();
    void dropRetiredBrowser(browser, this.#browserCloseGraceMs, this.#sleep).catch(() => undefined);
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
      const hung = await closeHungContext(late.context, this.#browserCloseGraceMs, this.#sleep);
      if (hung) this.#retire(browser);
      return;
    }
    if (!late.settled) this.#retire(browser);
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
