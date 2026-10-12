import type { TemplateDefinition } from './definition.ts';

export const lateServiceSession: TemplateDefinition = {
  key: 'late_service_session',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
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
  ],
  copy: {
    ar: 'سُجّلت جلسة متأخرة بتاريخ {{business_date}} في فرع {{branch_name_ar}}.',
    en: 'A late service session dated {{business_date}} was recorded at {{branch_name_en}}.',
  },
};
