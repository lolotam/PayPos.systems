import { createHash } from 'node:crypto';

/** أقصى حجم للحمولة بالبايت: خدمة الدفع بتقبل أقل من كيلوبايت واحد. */
export const PUSH_PAYLOAD_LIMIT_BYTES = 1024;

/** مدة بقاء الإشعار عند خدمة الدفع لو مفيش موعد انتهاء: ساعة. */
export const PUSH_DEFAULT_TTL_SECONDS = 3600;

/** مسار التطبيق اللي الإشعار بيفتحه: دايمًا مسار تطبيق الموظفين نفسه. */
export const PUSH_APP_PATH = '/personal';

/**
 * يبني حمولة الإشعار بالشكل اللي عامل الخدمة في المتصفح بيقراه.
 * القاعدة: الحمولة فيها v و title و body و tag و url و lang و t بالترتيب ده بالظبط، والـ url دايمًا مسار
 * تطبيق الموظفين، والحمولة بترفض لو أي حقل فاضي أو لو حجمها بالبايت أكبر من الحد.
 *
 * @param input العنوان والجسم والوسم واللغة ورمز التسليم بتوع الإشعار
 * @returns الحمولة كـ JSON، أو null لو حقل فاضي أو الحجم أكبر من الحد
 */
export function buildPushPayload(input: {
  title: string;
  body: string;
  tag: string;
  lang: 'ar' | 'en';
  token: string;
}): string | null {
  if (input.title === '' || input.body === '' || input.tag === '' || input.token === '')
    return null;
  const payload = JSON.stringify({
    v: 1,
    title: input.title,
    body: input.body,
    tag: input.tag,
    url: PUSH_APP_PATH,
    lang: input.lang,
    t: input.token,
  });
  return Buffer.byteLength(payload, 'utf8') > PUSH_PAYLOAD_LIMIT_BYTES ? null : payload;
}

/**
 * يحسب مدة بقاء الإشعار عند خدمة الدفع بالثواني.
 * القاعدة: الموعد النهائي بيحكم وقت بدء الطلب مش التسليم؛ لو الوقت خلص أو فاضل أقل من ثانية مفيش إرسال،
 * والحد الأقصى ساعة.
 *
 * @param deadline الموعد النهائي للإرسال أو null
 * @param now      اللحظة الحالية
 * @returns الثواني المتبقية، أو null لو الوقت خلص
 */
export function pushTimeToLiveSeconds(deadline: Date | null, now: Date): number | null {
  if (deadline === null) return PUSH_DEFAULT_TTL_SECONDS;
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const seconds = Math.floor(remaining / 1000);
  if (seconds === 0) return null;
  return Math.min(PUSH_DEFAULT_TTL_SECONDS, seconds);
}

/**
 * يحسب موضوع الإشعار اللي خدمة الدفع بتدمج بيه التكرار.
 * القاعدة: أول 32 حرف base64url من hash SHA-256 لمعرّف الحدث، فنفس الحدث دايمًا بيطلع بنفس الموضوع
 * والتكرار اللي لسه في الطابور بيتدمج في إشعار واحد.
 *
 * @param sourceEventId معرّف الحدث المصدر
 * @returns 32 حرف base64url
 */
export function pushTopic(sourceEventId: string): string {
  return createHash('sha256').update(sourceEventId, 'utf8').digest('base64url').slice(0, 32);
}
