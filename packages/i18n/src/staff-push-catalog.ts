// نصوص زر إشعارات الموبايل في شاشة الموظف الشخصية (ADR-0052 §7، WP-Q1 و WP-Q3).

/** نصوص قسم إشعارات الموبايل (en). */
export const staffPushEn = {
  unsupported: 'This phone cannot receive notifications.',
  storageBlocked: 'This browser blocks storage, so notifications cannot be turned on.',
  installLead: 'To get the notifications, add the app to the Home Screen.',
  installStep1: 'Tap the Share button.',
  installStep2: 'Choose "Add to Home Screen".',
  installStep3: 'Open PosPay from the Home Screen icon.',
  blocked: 'Notifications are blocked in the browser settings. Turn them on there, then come back.',
  off: 'Mobile notifications are off.',
  on: 'Notifications are on.',
  enable: 'Turn on mobile notifications',
  disable: 'Turn off',
  offline: 'There is no internet connection, so notifications cannot be turned on now.',
  reconnecting: 'Reconnecting…',
  invitationLead: 'Get a notice on this phone when you have not clocked in.',
  invitationEnable: 'Turn on',
  invitationDismiss: 'Not now',
  error: 'The notifications could not be turned on. Try again.',
} as const;

/** نصوص قسم إشعارات الموبايل (ar). */
export const staffPushAr = {
  unsupported: 'الموبايل ده مش هيوصله إشعارات.',
  storageBlocked: 'المتصفح ده بيمنع التخزين، فمش هينفع تشغّل الإشعارات.',
  installLead: 'علشان توصلك الإشعارات، ضيفي التطبيق للشاشة الرئيسية',
  installStep1: 'دوسي زرار المشاركة.',
  installStep2: 'اختاري «إضافة إلى الشاشة الرئيسية».',
  installStep3: 'افتحي PosPay من أيقونة الشاشة الرئيسية.',
  blocked: 'الإشعارات متقفلة في إعدادات المتصفح. شغّلها من هناك وبعدين ارجع.',
  off: 'إشعارات الموبايل مقفولة.',
  on: 'الإشعارات شغّالة.',
  enable: 'شغّل إشعارات الموبايل',
  disable: 'أوقّف الإشعارات',
  offline: 'مفيش إنترنت، فمش هينفع تشغّل الإشعارات دلوقتي.',
  reconnecting: 'بنتصل تاني…',
  invitationLead: 'هيوصلك إشعار على الموبايل ده لما ما تصمّمش.',
  invitationEnable: 'شغّل',
  invitationDismiss: 'مش دلوقتي',
  error: 'مش قادرين نشغّل الإشعارات. جرّب تاني.',
} satisfies Record<keyof typeof staffPushEn, string>;
