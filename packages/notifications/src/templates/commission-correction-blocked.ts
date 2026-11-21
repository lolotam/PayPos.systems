import type { TemplateDefinition } from './definition.ts';

/**
 * جرس التصحيح الموقوف (FR-049، CS-Q19): شهر المصدر وحده.
 * لا مبلغ ولا اسم موظفة ولا اسم عميل؛ التفاصيل تُقرأ من شاشة التصحيحات الموقوفة.
 */
export const commissionCorrectionBlocked: TemplateDefinition = {
  key: 'commission_correction_blocked',
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
    ar: 'فيه تصحيح عمولة موقوف عن شهر {{period}}: موظفة ناقصها خطة عمولة أو مرتب. افتح التصحيحات الموقوفة عشان يتصلّح.',
    en: 'A commission correction for {{period}} is on hold: an employee has no commission plan or no salary for that month. Open the blocked corrections to fix it.',
  },
};
