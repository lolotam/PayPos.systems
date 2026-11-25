import type { TemplateDefinition } from './definition.ts';

// TODO(spec): اسم القالب المعتمد من Meta ونص كلمة الترحيب النهائي عند غياب الاسم الأول (PP-272) يُحدَّدان مع تقديم القالب لـ Meta؛ approvedNames الافتراضي فاضي فيفضل rating_request مقفول (CONFIG_INVALID) لحد التفعيل.
/** كلمة الترحيب الثابتة عند غياب اسم العميل الأول في قالب التقييم (PP-272)؛ النص النهائي يُعتمد عند تقديم القالب لـ Meta. */
export const RATING_REQUEST_DEFAULT_GREETING: Readonly<Record<'ar' | 'en', string>> = {
  ar: 'عميلتنا العزيزة',
  en: 'valued guest',
};
/** قالب طلب التقييم عبر واتساب (RT-Q2 / PP-18.10): اسم الأول اختياري، والرابط بيتركّب في الذاكرة وقت الإرسال بدل rating_request_id. */
export const ratingRequest: TemplateDefinition = {
  key: 'rating_request',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'customer_first_name',
      type: 'text',
      required: false,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
      defaultValue: RATING_REQUEST_DEFAULT_GREETING,
    },
    {
      name: 'business_name',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'performers',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'rating_request_id',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'id',
    },
  ],
  copy: {
    ar: 'أهلاً {{customer_first_name}}، شكراً لزيارتك {{business_name}} النهارده. قيّمي خدمة {{performers}} من هنا: {{link}}. لو مش عايزة رسايل تقييم تاني، ابعتي "إيقاف" أو اختاري "مش عايزة رسايل" في نفس الصفحة.',
    en: 'Hi {{customer_first_name}}, thank you for visiting {{business_name}} today. Rate {{performers}}\'s service here: {{link}}. To stop rating messages, reply "STOP" or choose "No more messages" on the same page.',
  },
};
