import type { TemplateDefinition } from './definition.ts';

/**
 * جرس انتهاء المستند: نوع المستند وتاريخ الانتهاء بالظبط (AL-Q8).
 * معامل المعرّف يسافر مع الجرس ليعيد القارئ رقم المستند وقت العرض لمن يملك الصلاحية؛ رقم المستند نفسه لا يظهر في النص.
 */
export const documentExpiring: TemplateDefinition = {
  key: 'document_expiring',
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
      name: 'document_type_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'document_type_en',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'expires_on',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'date',
    },
    {
      name: 'document_id',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'id',
    },
  ],
  copy: {
    ar: 'مستند {{document_type_ar}} الخاص بـ {{employee_name_ar}} ينتهي يوم {{expires_on}}',
    en: "{{employee_name_en}}'s {{document_type_en}} expires on {{expires_on}}",
  },
};
