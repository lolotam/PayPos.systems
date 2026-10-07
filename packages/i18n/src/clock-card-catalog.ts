// قاموس كارت الحضور: قسم إدارة الموظف وقسم شاشة الاستقبال، مفصولان ليبقى en.ts تحت حد الأسطر.

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

/** نصوص شاشة استقبال الكارت على الجهاز المثبّت (en). */
export const clockCardPosEn = {
  cardTitle: 'Clock by card',
  cardLead:
    'Scan the attendance card with the reception scanner, or type its code and press Enter.',
  cardLabel: 'Attendance card code',
  cardOffline: 'Card clocking needs an internet connection. Connect and scan again.',
  cardInvalid: 'The card was not accepted. Check the card or ask a manager.',
  cardLimited: 'Too many wrong scans. Wait and try again.',
  cardLimitedFor: 'Too many wrong scans. Wait {seconds} seconds and try again.',
  cardForbidden: 'You do not have permission to clock staff by card on this device.',
  cardSignedOut: 'The operator is signed out. Sign in again before scanning a card.',
  cardSubmit: 'Clock',
} as const;

/** نصوص شاشة استقبال الكارت على الجهاز المثبّت (ar). */
export const clockCardPosAr = {
  cardTitle: 'تسجيل الحضور بالكارت',
  cardLead: 'مرّر كارت الحضور على ماسح الاستقبال، أو اكتب الكود واضغط Enter.',
  cardLabel: 'كود كارت الحضور',
  cardOffline: 'تسجيل الحضور بالكارت يحتاج اتصالاً بالإنترنت. اتصل وأعد المسح.',
  cardInvalid: 'لم يُقبل الكارت. تحقق من الكارت أو اطلب من المدير.',
  cardLimited: 'مسحات خاطئة كثيرة. انتظر ثم أعد المحاولة.',
  cardLimitedFor: 'مسحات خاطئة كثيرة. انتظر {seconds} ثانية ثم أعد المحاولة.',
  cardForbidden: 'لا تملك صلاحية تسجيل حضور الموظفين بالكارت على هذا الجهاز.',
  cardSignedOut: 'تم تسجيل خروج المشغّل. سجّل الدخول مجددًا قبل مسح الكارت.',
  cardSubmit: 'تسجيل',
};
