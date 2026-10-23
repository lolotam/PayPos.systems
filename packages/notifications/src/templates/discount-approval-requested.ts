import type { TemplateDefinition } from './definition.ts';

const display = (name: string) =>
  ({ name, type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' }) as const;
const safe = (name: string) =>
  ({ name, type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'safe' }) as const;

/**
 * جرس طلب موافقة الخصم (spec 057 FR-024): الفرع وأول خدمة في الطلب وعدد السطور وأعلى نسبة.
 * لا اسم عميل ولا هاتف ولا اسم الطالبة؛ التفاصيل تُقرأ من قائمة الموافقات المحروسة فقط.
 */
export const discountApprovalRequested: TemplateDefinition = {
  key: 'discount_approval_requested',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    display('branch_name_ar'),
    display('branch_name_en'),
    display('service_name_ar'),
    display('service_name_en'),
    safe('line_count'),
    safe('max_percent'),
  ],
  copy: {
    ar: 'طلب موافقة على خصم في فرع {{branch_name_ar}}: {{service_name_ar}}، عدد السطور {{line_count}}، الخصم حتى {{max_percent}}%.',
    en: 'Discount approval requested at {{branch_name_en}}: {{service_name_en}}, {{line_count}} line(s), discount up to {{max_percent}}%.',
  },
};
