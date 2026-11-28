import type { PdfContext } from './browser.ts';

/**
 * newContext المعلّق لو استنيناه بلا سقف، المهلة الكلية ما بتخلّصش الرندر.
 * رجوع السياق جوّه المهلة يتقفل لوحده؛ اللي ما جاش بيتساب معلّق والمتصل يتقاعد من غير close.
 */
export async function openWithinGrace(
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

const contextCloses = new WeakMap<PdfContext, Promise<void>>();

/**
 * يضمن وعد إغلاق واحد لكل سياق: تكرار close() وقت انتهاء المهلة يرجّع نفس الوعد المعلّق
 * بدل ما استدعاء تاني يرجّع نجاح فوري على سياق لسه محشور.
 */
export function closeContextOnce(context: PdfContext): Promise<void> {
  const existing = contextCloses.get(context);
  if (existing !== undefined) return existing;
  let closing: Promise<void>;
  try {
    closing = context.close();
  } catch {
    closing = Promise.reject(new Error('close failed'));
  }
  contextCloses.set(context, closing);
  return closing;
}

/** قفل السياق جوّه المهلة يسيب المتصفح. اللي ما خلّصش بيتقاعد من برّه، من غير close بلا حد. */
export async function closeHungContext(
  context: PdfContext,
  graceMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  let finished = false;
  const pending = closeContextOnce(context).then(
    () => {
      finished = true;
    },
    () => undefined,
  );
  await Promise.race([pending, sleep(graceMs)]);
  return !finished;
}
