// قاموس كارت الحضور لقسم إدارة الموظف، منفصل ليبقى en.ts تحت حد الأسطر.

/** نصوص قسم كارت الحضور في شاشة الموظف (en). */
export const clockCardAdminEn = {
  title: 'Attendance card',
  lead: 'One active card per employee; a new card replaces the active one and both changes are audited.',
  active: 'Active card',
  none: 'No active card.',
  issue: 'Card code',
  issueAction: 'Issue card',
  issued: 'Card issued.',
  revoke: 'Revoke card',
} as const;

/** نصوص قسم كارت الحضور في شاشة الموظف (ar). */
export const clockCardAdminAr = {
  title: 'كارت الحضور',
  lead: 'كارت نشط واحد لكل موظف؛ الكارت الجديد يستبدل النشط ويُدقَّق التغييران معًا.',
  active: 'الكارت النشط',
  none: 'لا يوجد كارت نشط.',
  issue: 'كود الكارت',
  issueAction: 'إصدار كارت',
  issued: 'تم إصدار الكارت.',
  revoke: 'إلغاء الكارت',
};
