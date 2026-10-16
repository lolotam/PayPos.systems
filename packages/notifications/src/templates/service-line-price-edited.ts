import type { TemplateDefinition } from './definition.ts';

/**
 * النص ثابت هنا وفي الكتالوج لأن المبلغ ليس اسمًا (المسألة #249)، واسم المعدّل لقطة؛ ولو مفيش موظف يُرسل مسمى الدور الثابت.
 */
export const serviceLinePriceEdited: TemplateDefinition = {
  key: 'service_line_price_edited',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    { name: 'service_name_ar', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
    { name: 'service_name_en', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
    { name: 'branch_name_ar', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
    { name: 'branch_name_en', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
    { name: 'business_date', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'date' },
    { name: 'previous_net', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'money' },
    { name: 'new_net', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'money' },
    { name: 'editor_name_ar', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
    { name: 'editor_name_en', type: 'text', required: true, sensitivity: 'safe', component: 'body', textKind: 'display_name' },
  ],
  copy: {
    ar: 'عدّل {{editor_name_ar}} خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان الصافي {{previous_net}} دينار وأصبح {{new_net}} دينار.',
    en: '{{editor_name_en}} edited {{service_name_en}} at {{branch_name_en}} dated {{business_date}}: the net was {{previous_net}} KWD and is now {{new_net}} KWD.',
  },
};
