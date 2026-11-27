import {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from '../domain/errors.ts';

/**
 * بيقول إن الخطأ ده مهلة رندر: إما مهلة الطباعة بتاعتنا، أو مهلة Playwright نفسها.
 * التصنيف يخص محوّل Playwright ويفضل برّه طبقة النطاق.
 *
 * @param error الخطأ المرفوض من الرندر
 * @returns صح لما الخطأ مهلة، مش فشل تاني
 */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DocumentRenderTimeoutError ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

/**
 * بيحوّل أي فشل غير معروف لخطأ نطاق معروف، عشان الـ API يحوّله لكود ثابت.
 *
 * @param error الخطأ المرفوض من الرندر
 * @returns خطأ النطاق: مهلة، مستند كبير، متصفح غير متاح، أو الخطأ الأصلي
 */
export function asRendererError(error: unknown): Error {
  if (error instanceof DocumentRenderTimeoutError) return error;
  if (error instanceof DocumentTooLargeError) return error;
  if (error instanceof DocumentRendererUnavailableError) return error;
  if (isTimeoutError(error)) return new DocumentRenderTimeoutError();
  if (error instanceof Error) return error;
  return new Error('DOCUMENT_RENDER_FAILED');
}

/**
 * سباق بين شغل الرندر والمهلة الكلية.
 * المهلة أو إشارة الإلغاء بترفع رفض بمهلة رندر، والنتيجة المتأخرة بتترمى.
 *
 * @param work شغل الرندر
 * @param ms المهلة الكلية بالميلي ثانية
 * @param signal إشارة إلغاء اختيارية من المستدعي
 * @returns بايتات PDF
 */
export function raceDeadline(
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
