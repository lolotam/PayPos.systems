import type { TemplateDefinition, TemplateParameter } from './definition.ts';

/**
 * معاملات جرسَي وصول الدخول: الموظفة والمنحِ والفرع وتاريخ ووقت الوصول، بترتيب واحد للجرسين.
 * الأسماء أسماء عرض تُرفض لو كانت رابطاً أو هاتفاً أو رمزاً، والتاريخ ميلادي والوقت محلي HH:MM.
 */
const staffAccessParameters: readonly TemplateParameter[] = [
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
    name: 'actor_name_ar',
    type: 'text',
    required: true,
    sensitivity: 'safe',
    component: 'body',
    textKind: 'display_name',
  },
  {
    name: 'actor_name_en',
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
    name: 'occurred_date',
    type: 'text',
    required: true,
    sensitivity: 'safe',
    component: 'body',
    textKind: 'date',
  },
  {
    name: 'occurred_time',
    type: 'text',
    required: true,
    sensitivity: 'safe',
    component: 'body',
    textKind: 'time',
  },
];

/** جرس منح دخول موظفة: مين منح ومتى وفي أي فرع (076-F2b-4). مفيش رقم سري ولا هاتف في النص. */
export const staffAccessGranted: TemplateDefinition = {
  key: 'staff_access_granted',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: staffAccessParameters,
  copy: {
    ar: 'منح {{actor_name_ar}} دخول موظفة لـ {{employee_name_ar}} في فرع {{branch_name_ar}} يوم {{occurred_date}} الساعة {{occurred_time}}.',
    en: '{{actor_name_en}} granted staff access to {{employee_name_en}} at {{branch_name_en}} on {{occurred_date}} at {{occurred_time}}.',
  },
};

/** جرس إعادة ضبط الرقم السري لموظفة من غير نفسها: مين أعاد ضبطه ومتى وفي أي فرع (076-F2b-4). */
export const staffPinSetByOther: TemplateDefinition = {
  key: 'staff_pin_set_by_other',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: staffAccessParameters,
  copy: {
    ar: 'أعاد {{actor_name_ar}} ضبط الرقم السري لـ {{employee_name_ar}} في فرع {{branch_name_ar}} يوم {{occurred_date}} الساعة {{occurred_time}}.',
    en: '{{actor_name_en}} reset the PIN for {{employee_name_en}} at {{branch_name_en}} on {{occurred_date}} at {{occurred_time}}.',
  },
};

/** جرس استعادة الموظفة رقمها السري بنفسها عبر رمز التحقق: مين استعاده ومتى وفي أي فرع (079-c1). */
export const staffPinRecovered: TemplateDefinition = {
  key: 'staff_pin_recovered',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: staffAccessParameters,
  copy: {
    ar: 'استعادت {{employee_name_ar}} رقمها السري بنفسها في فرع {{branch_name_ar}} يوم {{occurred_date}} الساعة {{occurred_time}}.',
    en: '{{employee_name_en}} recovered their own PIN at {{branch_name_en}} on {{occurred_date}} at {{occurred_time}}.',
  },
};
