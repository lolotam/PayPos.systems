import { DocumentRenderTimeoutError, DocumentRendererUnavailableError } from '../domain/errors.ts';
import { assertHtmlWithinLimit, assertPdfWithinLimit } from '../domain/limits.ts';
import type { DocumentRenderer, RenderOptions, StartOptions } from '../ports/document-renderer.ts';
import type { PdfBrowser, PdfBrowserFactory, PdfContext } from './browser.ts';
import { closeContextOnce } from './context-guards.ts';
import { asRendererError, isTimeoutError, raceDeadline } from './deadline.ts';
import { DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS, playwrightFactory } from './factory.ts';
import { closeOrKill, launchWithinTimeout, waitGate } from './launch.ts';
import { renderPage, type RenderPageHooks } from './render-page.ts';
import type { RendererOptions } from './renderer-options.ts';
import { closeAfterTimeout, dropRetiredBrowser } from './retire.ts';

export type { RendererOptions } from './renderer-options.ts';

const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 5000] as const;
const CLOSE_GRACE_MS = 5_000;
const LAUNCH_TIMEOUT_MS = 40_000;
const CONTEXT = { javaScriptEnabled: false, offline: true, serviceWorkers: 'block' } as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  #closingBrowser: PdfBrowser | null = null;
  #launchController: AbortController | null = null;
  #available = false;
  #closing = false;
  #launchFailures = 0;
  #relaunchNeeded = false;
  #stableTimer: ReturnType<typeof setTimeout> | undefined;
  #starting: Promise<void> | null = null;
  #launchInFlight: Promise<void> | null = null;
  #pendingCancel: Promise<void> | null = null;
  #relaunching: Promise<void> | null = null;
  #retiring: Promise<void> | null = null;
  #unavailable: Array<() => void> = [];
  #availableListeners: Array<() => void> = [];

  constructor(options: RendererOptions = {}) {
    this.#launchTimeoutMs = options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
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
    const playwrightTimeoutMs =
      this.#launchTimeoutMs === LAUNCH_TIMEOUT_MS
        ? DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS
        : Math.max(
            1,
            this.#launchTimeoutMs -
              Math.min(this.#browserCloseGraceMs, Math.floor(this.#launchTimeoutMs / 2)),
          );
    this.#factory = options.factory ?? playwrightFactory(playwrightTimeoutMs);
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

  start(options?: StartOptions): Promise<void> {
    // الإقلاع المكرّر لو المتصفح شغّال أو لسه بيقلع أو بيعيد الإطلاق أو اتقفل ما يفتحش متصفح تاني.
    if (this.#available || this.#closing || this.#relaunching !== null || options?.signal?.aborted) {
      return Promise.resolve();
    }
    if (this.#starting !== null) return this.#starting;
    const detachAbort = this.#attachLaunchAbort(options?.signal);
    const starting = this.#launchOnce(options?.signal).finally(() => {
      detachAbort();
      if (this.#starting === starting) this.#starting = null;
      if (
        !this.#available &&
        !this.#closing &&
        this.#retiring === null &&
        (this.#relaunchNeeded || !options?.signal?.aborted)
      ) {
        this.#relaunchNeeded = false;
        this.#scheduleRelaunch();
      }
    });
    this.#starting = starting;
    return starting;
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#relaunchNeeded = false;
    // الإطلاق المعلّق بيتلغي فورًا؛ المتصفح اللي يوصل بعدين بيتقفل في الكور.
    this.#launchController?.abort();
    this.#clearStable();
    this.#markUnavailable();
    const browser = this.#browser;
    this.#browser = null;
    if (browser === null) return;
    this.#closingBrowser = browser;
    try {
      await closeOrKill(browser, this.#closeGraceMs);
    } finally {
      this.#closingBrowser = null;
    }
  }

  kill(): void | Promise<void> {
    this.#closing = true;
    this.#relaunchNeeded = false;
    this.#launchController?.abort();
    this.#clearStable();
    this.#markUnavailable();
    // المتصفح اللي بيتقفل دلوقتي لسه شغّال؛ القتل هو اللي يفكّه.
    const browser = this.#browser ?? this.#closingBrowser;
    this.#browser = null;
    try {
      return browser?.kill?.();
    } catch {
      // إشارة القتل مش بتوقف إعادة الإطلاق؛ المتصفح القديم مش هو الحالي.
      return undefined;
    }
  }

  async render(html: string, options?: RenderOptions): Promise<Uint8Array> {
    assertHtmlWithinLimit(html);
    const browser = this.#browser;
    if (!this.#available || browser === null) throw new DocumentRendererUnavailableError();
    return this.#renderOnce(browser, html, options);
  }

  #attachLaunchAbort(signal: AbortSignal | undefined): () => void {
    if (signal === undefined) return () => undefined;
    const abort = (): void => {
      this.#launchController?.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    return () => signal.removeEventListener('abort', abort);
  }

  #launchOnce(signal?: AbortSignal): Promise<void> {
    // حارس واحد لكل إطلاق: start() وإعادة الإطلاق في الخلفية ما يفتحوش متصفحين مع بعض.
    if (this.#launchInFlight !== null) return this.#launchInFlight;
    const flight = this.#runSingleLaunch(signal).finally(() => {
      if (this.#launchInFlight === flight) this.#launchInFlight = null;
    });
    this.#launchInFlight = flight;
    return flight;
  }

  async #runSingleLaunch(signal?: AbortSignal): Promise<void> {
    // المتصفح المتقاعد والإلغاء المعلّق لازم يخلصوا الأول، عشان متصفحين ما يبقوش شغالين مع بعض.
    if (this.#retiring !== null) await waitGate(this.#retiring, signal);
    if (this.#pendingCancel !== null) await waitGate(this.#pendingCancel, signal);
    if (this.#closing || signal?.aborted) return;
    const controller = new AbortController();
    this.#launchController = controller;
    try {
      const outcome = await launchWithinTimeout(
        this.#factory.launch(controller.signal),
        this.#launchTimeoutMs,
        this.#closeGraceMs,
        controller.signal,
      );
      if (outcome.kind === 'cancelled' || outcome.kind === 'timeout') {
        if (outcome.kind === 'timeout') controller.abort();
        if (!this.#closing) {
          const settling = outcome.settled.finally(() => {
            if (this.#pendingCancel === settling) this.#pendingCancel = null;
          });
          this.#pendingCancel = settling;
        }
        if (outcome.kind === 'timeout') {
          this.#onLaunchError?.(new Error('DOCUMENT_LAUNCH_TIMEOUT'));
          this.#markUnavailable();
        }
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
    } finally {
      if (this.#launchController === controller) this.#launchController = null;
    }
  }

  #attach(browser: PdfBrowser): void {
    browser.on('disconnected', () => {
      if (this.#closing || this.#browser !== browser) return;
      this.#browser = null;
      this.#relaunchNeeded = true;
      this.#markUnavailable();
      this.#scheduleRelaunch();
    });
  }

  #markAvailable(): void {
    this.#relaunchNeeded = false;
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
    if (
      this.#closing ||
      this.#available ||
      this.#starting !== null ||
      this.#relaunching !== null ||
      this.#retiring !== null
    ) {
      return;
    }
    this.#relaunchNeeded = false;
    this.#relaunching = this.#relaunchLoop().finally(() => {
      this.#relaunching = null;
      if (!this.#closing && !this.#available && this.#starting === null && this.#retiring === null) {
        this.#scheduleRelaunch();
      }
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
        await closeContextOnce(opened).catch(() => undefined);
        throw new DocumentRenderTimeoutError();
      }
      context = opened;
      let timedOut = false;
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
      } catch (error) {
        timedOut = isTimeoutError(error);
        throw error;
      } finally {
        // قفل السياق المعلّق بيستهلك المهلة الكلية؛ القفل بيتم من فوق عبر closeAfterTimeout.
        if (!timedOut) await closeContextOnce(opened).catch(() => undefined);
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
        await closeAfterTimeout(context, opening, browser, {
          graceMs: this.#browserCloseGraceMs,
          sleep: this.#sleep,
          retire: (retired) => {
            this.#retire(retired);
          },
        });
      }
      throw mapped;
    }
  }

  /**
   * الإتاحة لازم تسقط حتى لو close معلّق، وإلا مفتاح الحياة يفضل يعرض المتصفح المعلّق.
   * إعادة الإطلاق بتتأجل لحد ما المتصفح يتقفل أو يتقتل، عشان متصفحين ما يبقوش مع بعض.
   */
  #retire(browser: PdfBrowser): void {
    if (this.#browser !== browser) return;
    this.#browser = null;
    this.#relaunchNeeded = true;
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    this.#retiring = gate;
    try {
      // بنحط حارس التقاعد قبل إشعار المستمعين عشان نداء start() المتزامن يستنى نهاية التقاعد.
      this.#markUnavailable();
      const retiring = dropRetiredBrowser(browser, this.#browserCloseGraceMs, this.#sleep).then(
        (outcome) => {
          if (!outcome.confirmed && !this.#closing) {
            this.#onLaunchError?.(new Error('DOCUMENT_RETIRE_UNCONFIRMED'));
            return outcome.exit;
          }
          return undefined;
        },
      );
      void retiring
        .catch(() => undefined)
        .finally(() => {
          releaseGate();
          if (this.#retiring === gate) this.#retiring = null;
          if (!this.#closing && !this.#available) this.#scheduleRelaunch();
        });
    } catch (error) {
      releaseGate();
      if (this.#retiring === gate) this.#retiring = null;
      throw error;
    }
  }

  #hooks(onAborted: RenderOptions['onAbortedRequest']): RenderPageHooks {
    return {
      onAbort: (url) => onAborted?.(url),
      ...(this.#onDocumentHtml === undefined ? {} : { onDocumentHtml: this.#onDocumentHtml }),
    };
  }
}
