import type { TemplateDefinition } from './definition.ts';

export const shiftNotClockedIn: TemplateDefinition = {
  key: 'shift_not_clocked_in',
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
    { name: 'shift_start', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: 'لم يُسجَّل حضور {{employee_name_ar}} لشفت الساعة {{shift_start}} في {{branch_name_ar}}',
    en: '{{employee_name_en}} has not clocked in for the {{shift_start}} shift at {{branch_name_en}}',
  },
};
