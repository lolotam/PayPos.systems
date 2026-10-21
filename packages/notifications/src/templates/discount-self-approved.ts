import type { TemplateDefinition } from './definition.ts';

const display = (name: string) =>
  ({ name, type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' }) as const;

/**
 * جرس المالك حين يوافق مدير على خصم خدمة نفّذها هو (DA-Q3، وليد 2026-10-21): الفرع والموافِق وأول خدمة وأعلى نسبة.
 * لا اسم عميل ولا هاتف؛ تفاصيل القرار تُقرأ من قوائم الموافقات المحروسة فقط.
 */
export const discountSelfApproved: TemplateDefinition = {
  key: 'discount_self_approved',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    display('branch_name_ar'),
    display('branch_name_en'),
    display('approver_name_ar'),
    display('approver_name_en'),
    display('service_name_ar'),
    display('service_name_en'),
    { name: 'max_percent', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'safe' },
  ],
  copy: {
    ar: 'وافق {{approver_name_ar}} على خصم حتى {{max_percent}}% على خدمة {{service_name_ar}} نفّذها بنفسه في فرع {{branch_name_ar}}.',
    en: '{{approver_name_en}} approved a discount of up to {{max_percent}}% on {{service_name_en}}, a service they performed, at {{branch_name_en}}.',
  },
};
