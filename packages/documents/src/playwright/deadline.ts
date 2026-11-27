import { DocumentRenderTimeoutError } from '../domain/errors.ts';

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
