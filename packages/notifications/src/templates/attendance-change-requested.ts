import type { TemplateDefinition } from './definition.ts';

export const attendanceChangeRequested: TemplateDefinition = {
  key: 'attendance_change_requested',
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
    { name: 'change', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: 'طلب {{change}} لـ {{employee_name_ar}} مستني موافقتك',
    en: '{{change}} requested for {{employee_name_en}}; awaiting your approval',
  },
};
