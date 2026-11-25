import type { TemplateDefinition } from './definition.ts';

/**
 * جرس «الكشف مستني المراجعة» (FR-055): شهر الكشف وحده.
 * لا مبلغ ولا اسم موظفة ولا اسم عميل؛ التفاصيل تُقرأ من شاشة كشوف العمولة.
 */
export const statementAwaitingReview: TemplateDefinition = {
  key: 'statement_awaiting_review',
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
    ar: 'كشف العمولة عن شهر {{period}} جاهز ومستني المراجعة.',
    en: 'The commission statement for {{period}} is ready and waiting for review.',
  },
};
