import type { TemplateDefinition } from './definition.ts';

/**
 * جرس «حدث عمولة اتوقف» (ADR-0012 §3): نوع الحدث ورقمه المرجعي.
 * لا مبلغ ولا اسم موظفة ولا اسم عميل؛ التفاصيل كلها في شاشة الدعم.
 */
export const commissionEventParked: TemplateDefinition = {
  key: 'commission_event_parked',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'event_type',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'safe',
    },
    {
      name: 'event_id',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'id',
    },
  ],
  copy: {
    ar: 'بيانات عمولة ما اتسجّلتش بسبب خطأ فني، واعتماد كشف عمولات الشهر واقف لحد ما المشكلة تتحل. كلّم الدعم وابعت لهم الرقم ده: {{event_id}} (النوع: {{event_type}}).',
    en: 'Some commission data could not be recorded because of a technical error, so the commission statement for this month cannot be approved until it is fixed. Contact support and give them this reference: {{event_id}} (type: {{event_type}}).',
  },
};
