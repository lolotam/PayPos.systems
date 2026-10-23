import type { TemplateDefinition } from './definition.ts';

/** جرس استثناء الحضور: الموظفة والفرع وتاريخ ووقت بصمة الدخول المفتوحة (AL-Q8b). */
export const attendanceExceptionRaised: TemplateDefinition = {
  key: 'attendance_exception_raised',
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
    {
      name: 'clock_in_date',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'date',
    },
    { name: 'clock_in_time', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: {
    ar: '{{employee_name_ar}} سجّلت دخول في {{branch_name_ar}} يوم {{clock_in_date}} الساعة {{clock_in_time}} ولم تسجّل خروج',
    en: '{{employee_name_en}} clocked in at {{branch_name_en}} on {{clock_in_date}} at {{clock_in_time}} and has not clocked out',
  },
};
