import type { TemplateDefinition } from './definition.ts';
import { attendanceChangeRequested } from './attendance-change-requested.ts';

export const attendanceChangeDecided: TemplateDefinition = {
  key: 'attendance_change_decided',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    ...attendanceChangeRequested.parameters,
    { name: 'decision', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
    { name: 'reason', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: '{{change}} لـ {{employee_name_ar}}: {{decision}}. السبب: {{reason}}',
    en: '{{change}} for {{employee_name_en}}: {{decision}}. Reason: {{reason}}',
  },
};
