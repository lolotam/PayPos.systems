import type { TemplateDefinition, TemplateParameter } from './definition.ts';

function bodyParam(name: string, textKind?: TemplateParameter['textKind']): TemplateParameter {
  return {
    name,
    type: 'text',
    required: true,
    sensitivity: 'safe',
    component: 'body',
    ...(textKind === undefined ? {} : { textKind }),
  };
}

/**
 * النص ثابت هنا وفي الكتالوج لأن المبلغ وعدد الجلسات أرقام مش أسماء.
 * الجرس بلا سبب الاسترداد وبلا اسم العميل وبلا هوية المسترد.
 */
export const packageRefundRecorded: TemplateDefinition = {
  key: 'package_refund_recorded',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    bodyParam('package_name_ar', 'display_name'),
    bodyParam('package_name_en', 'display_name'),
    bodyParam('branch_name_ar', 'display_name'),
    bodyParam('branch_name_en', 'display_name'),
    bodyParam('sessions'),
    bodyParam('amount', 'money'),
    bodyParam('business_date', 'date'),
  ],
  copy: {
    ar: 'استُردت {{sessions}} جلسة من باقة {{package_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: المبلغ {{amount}} دينار.',
    en: '{{sessions}} session(s) refunded from {{package_name_en}} at {{branch_name_en}} dated {{business_date}}: amount {{amount}} KWD.',
  },
};
