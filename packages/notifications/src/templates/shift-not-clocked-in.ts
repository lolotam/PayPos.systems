import type { TemplateDefinition } from './definition.ts';

export const shiftNotClockedIn: TemplateDefinition = {
  key: 'shift_not_clocked_in',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    { name: 'employee_name', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
    { name: 'branch_name', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
    { name: 'shift_start', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: 'لم يُسجَّل حضور {{employee_name}} لشفت الساعة {{shift_start}} في {{branch_name}}',
    en: '{{employee_name}} has not clocked in for the {{shift_start}} shift at {{branch_name}}',
  },
};
