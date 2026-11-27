import { z } from 'zod';

/**
 * مفاتيح قوالب تنبيهات الفريق التشغيلية للبريد والواتساب (AL-Q6، صف 62b-1): قالب واحد لكل نوع تنبيه من الخمسة عشر
 * (SHIFT_ENDS_SOON خارجها: إشعار موبايل للموظفة بس). القائمة هنا حرفية لأن الحزم المنتجة ما بتستوردش packages/notifications؛
 * واختبار التطابق في worker notifications بيقارنها بـ OPERATIONAL_EMAIL_KEYS عشان القائمتين ما ينحرفوش.
 */
export const TEAM_ALERT_TEMPLATE_KEYS = [
  'shift_not_clocked_in',
  'break_not_returned',
  'break_returned_other_branch',
  'attendance_exception_raised',
  'document_expiring',
  'late_service_session',
  'service_line_price_edited',
  'service_line_cancelled',
  'service_line_performers_changed',
  'discount_self_approved',
  'attendance_change_requested',
  'attendance_change_decided',
  'statement_awaiting_review',
  'statement_awaiting_approval',
  'low_rating',
] as const;
/** مفتاح قالب تنبيه فريق تشغيلي. */
export type TeamAlertTemplateKey = (typeof TEAM_ALERT_TEMPLATE_KEYS)[number];

/**
 * مستلم البريد التشغيلي لتنبيه فريق: العنوان ومفتاح القالب بس؛ لغة عربية، مراجعة 1، ومن غير أي معامل
 * (القالب عام وبلا بيانات شخصية، ADR-0018 §11)، فأي معامل بيخلّي الحدث يترفض.
 *
 * @param key مفتاح قالب النوع بالظبط
 * @returns مخطط المستلم
 */
export function teamAlertEmailRecipient<K extends TeamAlertTemplateKey>(key: K) {
  return z.strictObject({
    email: z.string().min(3).max(254),
    locale: z.literal('ar'),
    channel: z.literal('email'),
    template_key: z.literal(key),
    template_revision: z.literal(1),
    safe_parameters: z.tuple([]),
  });
}

/**
 * مستلم الواتساب التشغيلي لتنبيه فريق: بنفس شكل البريد لكن بالهاتف. الإرسال الفعلي بيفضل مقفول لحد ضبط قوالب Meta،
 * فالمحاولة بتتسجّل FAILED بسبب CONFIG_INVALID (ADR-0018 §11).
 *
 * @param key مفتاح قالب النوع بالظبط
 * @returns مخطط المستلم
 */
export function teamAlertWhatsappRecipient<K extends TeamAlertTemplateKey>(key: K) {
  return z.strictObject({
    phone: z.string().min(1).max(32),
    locale: z.literal('ar'),
    channel: z.literal('whatsapp'),
    template_key: z.literal(key),
    template_revision: z.literal(1),
    safe_parameters: z.tuple([]),
  });
}

/**
 * يوسّع مخطط مستلمي الجرس (داخل التطبيق) ليقبل كمان مستلم البريد ومستلم الواتساب لنفس النوع.
 *
 * @param inApp مخطط مستلم الجرس الحالي
 * @param key مفتاح القالب التشغيلي للنوع
 * @returns اتحاد المستلمين الثلاثة
 */
export function withTeamAlertChannels<S extends z.ZodType, K extends TeamAlertTemplateKey>(
  inApp: S,
  key: K,
) {
  return z.union([inApp, teamAlertEmailRecipient(key), teamAlertWhatsappRecipient(key)]);
}
