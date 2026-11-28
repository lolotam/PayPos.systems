import { DocumentRenderTimeoutError } from '../domain/errors.ts';
import { assertPdfWithinLimit } from '../domain/limits.ts';
import type { PdfBrowser, PdfContext, PdfPage } from './browser.ts';
import { closeContextOnce } from './context-guards.ts';
import { asRendererError, isTimeoutError, raceDeadline } from './deadline.ts';
import { closeAfterTimeout } from './retire.ts';

export interface RenderPageHooks {
  readonly onAbort: (url: string) => void;
  readonly onDocumentHtml?: (outerHtml: string) => void;
}

export interface RenderPageTimeouts {
  readonly contentMs: number;
  readonly pdfMs: number;
  /** إلغاء مؤقّت الطباعة لما المهلة الكلية تسبق. السباق نفسه ما بيترفضش من الإشارة دي. */
  readonly signal?: AbortSignal;
}

async function settleFonts(page: PdfPage): Promise<void> {
  try {
    await page.evaluate('document.fonts.ready');
  } catch {
    // جافاسكربت مقفول في السياق؛ waitUntil load هو انتظار تحميل الخط المضمّن.
  }
}

function abandon(work: Promise<unknown>): void {
  work.catch(() => undefined);
}

/**
 * `page.pdf` مالوش مهلة. السباق هو اللي بيلحق مهلة الطباعة قبل المهلة الكلية.
 * الإشارة بتلغي المؤقّت بس، عشان إغلاق السياق ما يحصلش مرتين.
 */
function printWithin(
  work: Promise<Uint8Array>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (!(ms > 0)) {
    abandon(work);
    return Promise.reject(new DocumentRenderTimeoutError());
  }
  if (signal?.aborted === true) {
    abandon(work);
    return new Promise(() => undefined);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<Uint8Array>((_resolve, reject) => {
    const fail = (): void => {
      abandon(work);
      reject(new DocumentRenderTimeoutError());
    };
    timer = setTimeout(fail, ms);
    signal?.addEventListener(
      'abort',
      () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        abandon(work);
      },
      { once: true },
    );
  });
  return Promise.race([work, wait]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * صفحة واحدة: كل طلب شبكة بيتلغى، والجافاسكربت متقفل من برّه على السياق.
 *
 * @param context سياق معزول
 * @param html المستند
 * @param timeouts مهلة المحتوى ومهلة الطباعة
 * @param hooks تسجيل الطلبات الملغاة ولقطة DOM اختيارية
 * @returns بايتات PDF
 */
export async function renderPage(
  context: PdfContext,
  html: string,
  timeouts: RenderPageTimeouts,
  hooks: RenderPageHooks,
): Promise<Uint8Array> {
  await context.route('**/*', async (route) => {
    hooks.onAbort(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();
  let timedOut = false;
  try {
    await page.setContent(html, { timeout: timeouts.contentMs, waitUntil: 'load' });
    await settleFonts(page);
    if (hooks.onDocumentHtml !== undefined && page.outerHtml !== undefined) {
      hooks.onDocumentHtml(await page.outerHtml());
    }
    return await printWithin(
      page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      }),
      timeouts.pdfMs,
      timeouts.signal,
    );
  } catch (error) {
    timedOut = isTimeoutError(error) || timeouts.signal?.aborted === true;
    throw error;
  } finally {
    // قفل الصفحة المعلّق بيستهلك مهلة الطباعة، فبنبلّغه ونرميه؛ المتصفح بيتقفل من فوق.
    const closing = Promise.resolve()
      .then(() => page.close())
      .catch(() => undefined);
    if (!timedOut) await closing;
  }
}

const CONTEXT_OPTIONS = { javaScriptEnabled: false, offline: true, serviceWorkers: 'block' } as const;

/** خيارات تنفيذ محاولة رندر كاملة داخل سياق معزول مع مهلتي الطباعة والإغلاق. */
export interface RenderAttemptConfig {
  readonly contentMs: number;
  readonly pdfMs: number;
  readonly overallMs: number;
  readonly closeGraceMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal | undefined;
  readonly hooks: RenderPageHooks;
  readonly retire: (browser: PdfBrowser) => void;
}

/** يرندر المستند في سياق معزول واحد ويعيد تقاعد المتصفح لو إغلاق السياق علّق بعد المهلة. */
export async function renderBrowserDocument(
  browser: PdfBrowser,
  html: string,
  config: RenderAttemptConfig,
): Promise<Uint8Array> {
  let context: PdfContext | undefined;
  let abandoned = false;
  const print = new AbortController();
  const opening = browser.newContext(CONTEXT_OPTIONS);
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
        { contentMs: config.contentMs, pdfMs: config.pdfMs, signal: print.signal },
        config.hooks,
      );
      return assertPdfWithinLimit(pdf);
    } catch (error) {
      timedOut = isTimeoutError(error);
      throw error;
    } finally {
      if (!timedOut) await closeContextOnce(opened).catch(() => undefined);
    }
  });
  try {
    return await raceDeadline(work, config.overallMs, config.signal);
  } catch (error) {
    abandoned = true;
    print.abort();
    const mapped = asRendererError(error);
    if (mapped instanceof DocumentRenderTimeoutError) {
      await closeAfterTimeout(context, opening, browser, {
        graceMs: config.closeGraceMs,
        sleep: config.sleep,
        retire: config.retire,
      });
    }
    throw mapped;
  }
}
