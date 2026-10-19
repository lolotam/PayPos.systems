import type { PdfContext, PdfPage } from './browser.ts';

export interface RenderPageHooks {
  readonly onAbort: (url: string) => void;
  readonly onDocumentHtml?: (outerHtml: string) => void;
}

export interface RenderPageTimeouts {
  readonly contentMs: number;
  readonly pdfMs: number;
}

async function settleFonts(page: PdfPage): Promise<void> {
  try {
    await page.evaluate('document.fonts.ready');
  } catch {
    // جافاسكربت مقفول في السياق؛ waitUntil load هو انتظار تحميل الخط المضمّن.
  }
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
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: timeouts.pdfMs,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}
