import type { TemplateDefinition } from './definition.ts';

/**
 * النص ثابت هنا وفي الكتالوج لأن صافي السطر مبلغ وليس اسمًا.
 * الجرس بلا سبب وبلا اسم منفّذ وبلا هوية من غيّر؛ الثلاثة تُقرأ فقط من سجل التغيير المحروس.
 */
export const serviceLinePerformersChanged: TemplateDefinition = {
  key: 'service_line_performers_changed',
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
      name: 'line_net',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'money',
    },
  ],
  copy: {
    ar: 'تغيّر منفّذو خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: صافي السطر {{line_net}} دينار.',
    en: 'The performers of {{service_name_en}} at {{branch_name_en}} dated {{business_date}} were changed: the line net is {{line_net}} KWD.',
  },
};
