import { DocumentRendererUnavailableError } from '../domain/errors.ts';
import { assertHtmlWithinLimit } from '../domain/limits.ts';
import type { DocumentRenderer, RenderOptions, StartOptions } from '../ports/document-renderer.ts';
import type { PdfBrowser } from './browser.ts';
import {
  createBrowserShutdown, createSharedStart, launchWithinTimeout, resolveLaunchCleanupGate, retryBlockedShutdown, waitGate,
  watchUnconfirmedExit, type BrowserShutdown, type SharedStart,
} from './launch.ts';
import { renderBrowserDocument } from './render-page.ts';
import { resolveRendererConfig, type RendererOptions, type ResolvedRendererConfig } from './renderer-options.ts';

export type { RendererOptions } from './renderer-options.ts';

/**
 * Chromium واحد للعملية. كل رندر سياق جديد من غير جافاسكربت ومن غير شبكة.
 * سقوط المتصفح بيعيد الإطلاق بتأخير قابل للحقن؛ الإغلاق المتعمد ما بيعيدش الإطلاق.
 */
export class PlaywrightDocumentRenderer implements DocumentRenderer {
  readonly #cfg: ResolvedRendererConfig;
  #browser: PdfBrowser | null = null;
  #shutdown: BrowserShutdown | null = null;
  #launchController: AbortController | null = null;
  readonly #closeAbort = new AbortController();
  #available = false;
  #closing = false;
  #launchFailures = 0;
  #relaunchNeeded = false;
  #stableTimer: ReturnType<typeof setTimeout> | undefined;
  #activeStart: SharedStart | null = null;
  #launchAborted = false;
  #launchInFlight: Promise<void> | null = null;
  #pendingCancel: Promise<void> | null = null;
  #relaunching: Promise<void> | null = null;
  #retiring: Promise<void> | null = null;
  #closingPromise: Promise<void> | null = null;
  #closingRun: Promise<void> | null = null;
  #closingExit: Promise<void> | null = null;
  #releaseClosingExit: (() => void) | null = null;
  #unavailable: Array<() => void> = [];
  #availableListeners: Array<() => void> = [];

  constructor(options: RendererOptions = {}) {
    this.#cfg = resolveRendererConfig(options);
  }

  isAvailable(): boolean {
    return this.#available;
  }

  get unconfirmedExit(): Promise<void> | null {
    const idle =
      this.#closingExit === null &&
      this.#retiring === null &&
      this.#pendingCancel === null &&
      this.#launchInFlight === null;
    return idle ? null : this.#drainExitGates();
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
    if (this.#activeStart !== null) return this.#activeStart.join(options?.signal);
    const active = createSharedStart(() => {
      this.#launchAborted = true;
      this.#launchController?.abort();
      if (this.#activeStart === active) this.#activeStart = null;
    });
    this.#activeStart = active;
    const waiter = active.join(options?.signal);
    void this.#launchOnce(active.signal).finally(() => {
      const stillWaited = active.finish();
      if (this.#activeStart === active) this.#activeStart = null;
      if (stillWaited && !this.#available && !this.#closing) this.#relaunchNeeded = true;
      const shouldRelaunch = !this.#available && !this.#closing && this.#retiring === null && this.#relaunchNeeded;
      active.resolveWaiters();
      if (shouldRelaunch) this.#scheduleRelaunch();
    });
    return waiter;
  }

  close(): Promise<void> {
    this.#beginShutdown();
    this.#closingPromise ??= this.#runClose().finally(() => {
      this.#closingPromise = null;
    });
    return this.#closingPromise;
  }

  kill(): void | Promise<void> {
    this.#beginShutdown();
    const shutdown = this.#ensureShutdown();
    if (shutdown === null) return this.unconfirmedExit ?? undefined;
    this.#openClosingGate();
    const result = shutdown.kill();
    if (result === undefined) {
      this.#confirmBrowserExit(shutdown);
      return this.unconfirmedExit ?? undefined;
    }
    return this.#recordKillPromise(shutdown, result);
  }

  async render(html: string, options?: RenderOptions): Promise<Uint8Array> {
    assertHtmlWithinLimit(html);
    const browser = this.#browser;
    if (!this.#available || browser === null) throw new DocumentRendererUnavailableError();
    return this.#renderOnce(browser, html, options);
  }

  #launchOnce(signal?: AbortSignal): Promise<void> {
    // حارس واحد لكل إطلاق: start() وإعادة الإطلاق في الخلفية ما يفتحوش متصفحين مع بعض.
    if (this.#launchInFlight !== null && !this.#launchAborted) return this.#launchInFlight;
    this.#launchAborted = false;
    const prior = this.#launchInFlight;
    let releaseFlight!: () => void;
    const flight = new Promise<void>((resolve) => { releaseFlight = resolve; });
    this.#launchInFlight = flight;
    void (async () => {
      if (prior !== null) await prior.catch(() => undefined);
      if (!this.#closing && !signal?.aborted) await this.#runSingleLaunch(signal);
    })().finally(() => {
      if (this.#launchInFlight === flight) this.#launchInFlight = null;
      releaseFlight();
    });
    return flight;
  }

  async #drainExitGates(): Promise<void> {
    while (
      this.#launchInFlight !== null ||
      this.#closingExit !== null ||
      this.#retiring !== null ||
      this.#pendingCancel !== null
    ) {
      if (this.#launchInFlight !== null) {
        await this.#launchInFlight.catch(() => undefined);
        continue;
      }
      const gate = this.#closingExit ?? this.#retiring ?? this.#pendingCancel;
      if (gate !== null) await gate;
    }
  }

  #beginShutdown(): void {
    this.#closing = true;
    this.#relaunchNeeded = false;
    this.#closeAbort.abort();
    this.#launchController?.abort();
    this.#clearStable();
    this.#markUnavailable();
  }

  #openClosingGate(): Promise<void> {
    if (this.#closingExit !== null) return this.#closingExit;
    const gate = new Promise<void>((resolve) => {
      this.#releaseClosingExit = resolve;
    });
    this.#closingExit = gate;
    return gate;
  }

  #ensureShutdown(): BrowserShutdown | null {
    if (this.#browser !== null) {
      this.#shutdown = createBrowserShutdown(this.#browser);
      this.#browser = null;
    }
    return this.#shutdown;
  }

  #confirmBrowserExit(shutdown: BrowserShutdown): void {
    if (this.#shutdown === shutdown) this.#shutdown = null;
    const release = this.#releaseClosingExit;
    this.#closingExit = null;
    this.#releaseClosingExit = null;
    release?.();
  }

  async #closeShutdown(shutdown: BrowserShutdown): Promise<void> {
    if (this.#closingRun !== null && this.#shutdown === shutdown) return this.#closingRun;
    this.#shutdown = shutdown;
    this.#openClosingGate();
    const run = shutdown.runClose(this.#cfg.closeGraceMs).then((outcome) => {
      if (this.#shutdown !== shutdown) return;
      if (outcome.confirmed) this.#confirmBrowserExit(shutdown);
      else this.#recordUnconfirmedClose(shutdown, outcome.exit);
    });
    const tracked = run.finally(() => {
      if (this.#closingRun === tracked) this.#closingRun = null;
    });
    this.#closingRun = tracked;
    return tracked;
  }

  #retireAbandonedBrowser(browser: PdfBrowser): Promise<void> {
    const shutdown = createBrowserShutdown(browser);
    if (this.#closing) return this.#closeShutdown(shutdown).then(() => this.#closingExit ?? undefined);
    this.#shutdown = shutdown;
    return shutdown
      .runClose(this.#cfg.closeGraceMs)
      .then((out) => (out.confirmed ? undefined : Promise.race([out.exit, shutdown.confirmed])))
      .catch(() => undefined)
      .finally(() => this.#confirmBrowserExit(shutdown));
  }

  #cleanupGateForError(error: unknown): Promise<void> | undefined {
    return resolveLaunchCleanupGate(
      error,
      (err) => this.#cfg.onLaunchError?.(err),
      (shutdown) => { this.#shutdown = shutdown; },
      (shutdown) => this.#confirmBrowserExit(shutdown),
    );
  }

  async #runClose(): Promise<void> {
    const priorShutdown = this.#shutdown;
    if (this.#launchInFlight !== null) await this.#launchInFlight.catch(() => undefined);
    const shutdown = this.#browser !== null ? this.#ensureShutdown() : (this.#shutdown ?? priorShutdown);
    if (shutdown === null) return;
    await this.#closeShutdown(shutdown);
  }

  #recordKillPromise(shutdown: BrowserShutdown, result: Promise<void>): Promise<void> {
    this.#openClosingGate();
    return result.then(async () => {
      this.#confirmBrowserExit(shutdown);
      await this.unconfirmedExit;
    });
  }

  #notifyUnconfirmed(code: string, immediate: boolean): void {
    const err = new Error(code);
    this.#cfg.onLaunchError?.(err);
    if (immediate) this.#cfg.onUnconfirmedExit?.(err);
  }

  #recordUnconfirmedClose(shutdown: BrowserShutdown, exit: Promise<void>): void {
    this.#shutdown = shutdown;
    const gate = this.#openClosingGate();
    const pending = gate.finally(() => {
      if (this.#pendingCancel === pending) this.#pendingCancel = null;
    });
    this.#pendingCancel = pending;
    void exit.then(() => this.#confirmBrowserExit(shutdown));
    this.#notifyUnconfirmed('DOCUMENT_CLOSE_UNCONFIRMED', true);
  }

  #watchUnconfirmed(settled: Promise<void>, code: string, includeLaunchError: boolean): void {
    watchUnconfirmedExit(settled, this.#cfg.unconfirmedExitTimeoutMs, () => {
      if (this.#closing) return;
      if (includeLaunchError) this.#notifyUnconfirmed(code, true);
      else this.#cfg.onUnconfirmedExit?.(new Error(code));
    });
  }

  #trackPendingCancel(settled: Promise<void>): void {
    const settling = settled.finally(() => {
      if (this.#pendingCancel === settling) this.#pendingCancel = null;
    });
    this.#pendingCancel = settling;
    this.#watchUnconfirmed(settling, 'DOCUMENT_LAUNCH_CANCEL_UNCONFIRMED', true);
  }

  async #runSingleLaunch(signal?: AbortSignal): Promise<void> {
    // المتصفح المتقاعد والإلغاء المعلّق لازم يخلصوا الأول، عشان متصفحين ما يبقوش شغالين مع بعض.
    if (this.#retiring !== null) await waitGate(this.#retiring, signal, this.#closeAbort.signal);
    if (this.#pendingCancel !== null) await waitGate(this.#pendingCancel, signal, this.#closeAbort.signal);
    if (this.#closing || signal?.aborted) return;
    const controller = new AbortController();
    this.#launchController = controller;
    try {
      const outcome = await launchWithinTimeout(
        this.#cfg.factory.launch(controller.signal),
        this.#cfg.launchTimeoutMs,
        this.#cfg.closeGraceMs,
        controller.signal,
        (late) => this.#retireAbandonedBrowser(late),
        (err) => this.#cleanupGateForError(err),
      );
      if (outcome.kind === 'cancelled' || outcome.kind === 'timeout') {
        if (outcome.kind === 'timeout') controller.abort();
        this.#trackPendingCancel(outcome.settled);
        if (outcome.kind === 'timeout') {
          this.#cfg.onLaunchError?.(new Error('DOCUMENT_LAUNCH_TIMEOUT'));
          this.#markUnavailable();
        }
        return;
      }
      if (outcome.kind === 'error') {
        if (outcome.cleanup !== undefined) this.#trackPendingCancel(outcome.cleanup);
        throw outcome.error;
      }
      const browser = outcome.browser;
      if (this.#closing || controller.signal.aborted || (signal?.aborted ?? false)) {
        controller.abort();
        if (this.#closing) return await this.#closeShutdown(createBrowserShutdown(browser));
        this.#trackPendingCancel(this.#retireAbandonedBrowser(browser));
        return;
      }
      this.#browser = browser;
      this.#attach(browser);
      this.#markAvailable();
    } catch (error) {
      this.#cfg.onLaunchError?.(error);
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
    }, this.#cfg.stableForMs);
    timer.unref();
    this.#stableTimer = timer;
  }

  #clearStable(): void {
    if (this.#stableTimer === undefined) return;
    clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
  }

  #scheduleRelaunch(): void {
    const busy =
      this.#closing || this.#available || this.#activeStart !== null || this.#relaunching !== null || this.#retiring !== null;
    if (busy) return;
    this.#relaunchNeeded = false;
    this.#relaunching = this.#relaunchLoop().finally(() => {
      this.#relaunching = null;
      if (!this.#closing && !this.#available && this.#activeStart === null && this.#retiring === null) {
        this.#scheduleRelaunch();
      }
    });
  }

  async #relaunchLoop(): Promise<void> {
    while (!this.#closing && !this.#available) {
      const index = Math.min(this.#launchFailures, this.#cfg.backoff.length - 1);
      const delayMs = this.#cfg.backoff[index] ?? 0;
      this.#launchFailures += 1;
      await this.#cfg.sleep(delayMs);
      if (this.#closing) return;
      const blocked = this.#retiring !== null || this.#pendingCancel !== null;
      if (await retryBlockedShutdown(this.#shutdown, blocked, this.#cfg.onLaunchError)) continue;
      await this.#launchOnce();
    }
  }

  #renderOnce(browser: PdfBrowser, html: string, options: RenderOptions | undefined): Promise<Uint8Array> {
    return renderBrowserDocument(browser, html, {
      contentMs: this.#cfg.contentTimeoutMs,
      pdfMs: this.#cfg.pdfTimeoutMs,
      overallMs: this.#cfg.overallTimeoutMs,
      closeGraceMs: this.#cfg.browserCloseGraceMs,
      sleep: this.#cfg.sleep,
      signal: options?.signal,
      hooks: {
        onAbort: (url) => options?.onAbortedRequest?.(url),
        ...(this.#cfg.onDocumentHtml === undefined ? {} : { onDocumentHtml: this.#cfg.onDocumentHtml }),
      },
      retire: (retired) => this.#retire(retired),
    });
  }

  /**
   * الإتاحة لازم تسقط حتى لو close معلّق، وإلا مفتاح الحياة يفضل يعرض المتصفح المعلّق.
   * إعادة الإطلاق بتتأجل لحد ما المتصفح يتقفل أو يتقتل، عشان متصفحين ما يبقوش مع بعض.
   */
  #retire(browser: PdfBrowser): void {
    if (this.#browser !== browser) return;
    this.#browser = null;
    this.#relaunchNeeded = true;
    const shutdown = createBrowserShutdown(browser);
    this.#shutdown = shutdown;
    let releaseGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    this.#retiring = gate;
    try {
      // بنحط حارس التقاعد قبل إشعار المستمعين عشان نداء start() المتزامن يستنى نهاية التقاعد.
      this.#markUnavailable();
      const retiring = shutdown.runClose(this.#cfg.browserCloseGraceMs, this.#cfg.sleep).then((outcome) => {
        if (outcome.confirmed) {
          this.#confirmBrowserExit(shutdown);
          return undefined;
        }
        const settled = Promise.race([outcome.exit, shutdown.confirmed]).then(() => this.#confirmBrowserExit(shutdown));
        if (!this.#closing) {
          this.#notifyUnconfirmed('DOCUMENT_RETIRE_UNCONFIRMED', false);
          this.#watchUnconfirmed(settled, 'DOCUMENT_RETIRE_UNCONFIRMED', false);
        }
        return settled;
      });
      void retiring.catch(() => undefined).finally(() => {
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
}
