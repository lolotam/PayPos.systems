/** مفاتيح شاشة الورديات الخاصة بالبريك وإعدادات الحد اليومي، منفصلة عشان ملف الكتالوج يفضل تحت الحد. */
export const scheduleShellEn = {
  schedule_break: 'Break',
  schedule_break_start: 'Break start',
  schedule_break_end: 'Break end',
  schedule_break_add: 'Add break',
  schedule_break_remove: 'Remove break',
  schedule_breakDetail: 'Shift on {day} starting {start}',
  schedule_settings_title: 'Schedule settings',
  schedule_settings_limit: 'Maximum shifts starting per day',
  schedule_settings_default: 'Default: 3 shifts per day',
  schedule_settings_save: 'Save schedule settings',
  schedule_dayLimitDetail: 'Limit {limit} shifts per day: {dates}',
};

export const scheduleShellAr: Record<keyof typeof scheduleShellEn, string> = {
  schedule_break: 'البريك',
  schedule_break_start: 'بداية البريك',
  schedule_break_end: 'نهاية البريك',
  schedule_break_add: 'إضافة بريك',
  schedule_break_remove: 'إزالة البريك',
  schedule_breakDetail: 'وردية يوم {day} اللي بتبدأ {start}',
  schedule_settings_title: 'إعدادات الورديات',
  schedule_settings_limit: 'أقصى عدد ورديات تبدأ في اليوم',
  schedule_settings_default: 'الافتراضي: 3 ورديات في اليوم',
  schedule_settings_save: 'حفظ إعدادات الورديات',
  schedule_dayLimitDetail: 'الحد {limit} ورديات في اليوم: {dates}',
};
