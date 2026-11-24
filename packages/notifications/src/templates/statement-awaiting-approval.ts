import type { TemplateDefinition } from './definition.ts';

/**
 * جرس «الكشف مستني الاعتماد» (FR-030، CS-Q52 = PP-227): شهر الكشف وحده.
 * لا مبلغ ولا اسم موظفة ولا اسم عميل؛ التفاصيل تُقرأ من شاشة كشوف العمولة.
 */
export const statementAwaitingApproval: TemplateDefinition = {
  key: 'statement_awaiting_approval',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'period',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'period',
    },
  ],
  copy: {
    ar: 'كشف العمولة عن شهر {{period}} اتراجع، ومستني الاعتماد.',
    en: 'The commission statement for {{period}} has been reviewed and is waiting for approval.',
  },
};
