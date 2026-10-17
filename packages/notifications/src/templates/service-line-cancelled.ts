import type { TemplateDefinition } from './definition.ts';

/**
 * النص ثابت هنا وفي الكتالوج لأن صافي السطر مبلغ وليس اسمًا.
 * الجرس بلا هوية المُلغي وبلا سبب؛ الاثنان يُقرآن فقط من سجل الإلغاء المحروس.
 */
export const serviceLineCancelled: TemplateDefinition = {
  key: 'service_line_cancelled',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'service_name_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'service_name_en',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'branch_name_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'branch_name_en',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'business_date',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'date',
    },
    {
      name: 'cancelled_net',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'money',
    },
  ],
  copy: {
    ar: 'أُلغيت خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان صافي السطر {{cancelled_net}} دينار.',
    en: '{{service_name_en}} was cancelled at {{branch_name_en}} dated {{business_date}}: the line net was {{cancelled_net}} KWD.',
  },
};
