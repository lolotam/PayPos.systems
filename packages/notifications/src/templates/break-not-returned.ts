import type { TemplateDefinition } from './definition.ts';

export const breakNotReturned: TemplateDefinition = {
  key: 'break_not_returned',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'employee_name_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'employee_name_en',
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
    { name: 'break_end', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: 'لم يُسجَّل رجوع {{employee_name_ar}} من البريك المنتهي الساعة {{break_end}} في {{branch_name_ar}}',
    en: '{{employee_name_en}} has not clocked back in from the break that ended at {{break_end}} at {{branch_name_en}}',
  },
};
