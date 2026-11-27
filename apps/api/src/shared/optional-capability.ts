const OPTIONAL_DEADLINE_MS = 1000;

// Composition-root work only: ordinary readiness does not wait for an optional capability.
export async function optionalWithin<T>(work: () => Promise<T>, ms = OPTIONAL_DEADLINE_MS) {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('OPTIONAL_CAPABILITY_TIMEOUT')), ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Every disposer starts, even if another throws; force-close is selected by the owning adapter.
export async function closeOptional(work: readonly (() => Promise<unknown> | undefined)[]) {
  await optionalWithin(() =>
    Promise.allSettled(work.map((close) => Promise.resolve().then(close))),
  ).catch(() => undefined);
}

// الأكواد المسموح كتابتها في السجل: أسماء متغيرات البيئة ورموز الإعداد، وما فيها أي قيمة سرية.
const KNOWN_WHATSAPP_SETUP_ERROR =
  /^(?:WHATSAPP_CONFIG_INVALID:[A-Z0-9_]+|WHATSAPP_SENDER_CONFIG_INVALID|WHATSAPP_STOP_BUTTON_CONFIG_INVALID|WHATSAPP_CAPABILITY_UNAVAILABLE|PLATFORM_WHATSAPP_DATABASE_URL_INVALID|PLATFORM_NOTIFICATIONS_PRIVILEGES_INVALID|OPTIONAL_CAPABILITY_TIMEOUT)$/;

// كود المحرك (postgres/redis) رمز قصير معروف، بيتنقل بدل رسالة الخطأ اللي فيها رابط اتصال.
const SAFE_DRIVER_CODE = /^[A-Z0-9_]{2,32}$/;

/**
 * بيصنّف سبب فشل تهيئة بوابة الواتساب لسبب آمن ينكتب في السجل.
 * الأكواد المعروفة بتتنقل زي ما هي، وكود المحرك بيتحوّل لصيغة DB_OR_IO_<CODE>، وأي حاجة تانية
 * بترجع UNKNOWN_SETUP_ERROR. رسالة الخطأ نفسها ما بتتنقلش أبداً: ممكن تحمل رابط اتصال أو توكن أو رقم عميل.
 *
 * @param error الخطأ اللي رماه تهيئة البوابة
 * @returns سبب آمن قصير ينكتب في السجل كـ subReason
 */
export function whatsappSetupSubReason(error: unknown): string {
  if (error instanceof Error && KNOWN_WHATSAPP_SETUP_ERROR.test(error.message))
    return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && SAFE_DRIVER_CODE.test(code)) return `DB_OR_IO_${code}`;
  }
  return 'UNKNOWN_SETUP_ERROR';
}
