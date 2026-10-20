import { DocumentRenderTimeoutError } from '../domain/errors.ts';
import type { PdfContext, PdfPage } from './browser.ts';

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
  } finally {
    await page.close().catch(() => undefined);
  }
}
