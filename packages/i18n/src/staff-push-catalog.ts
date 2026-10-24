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
  invitationLead: 'Get a notice on this phone if your shift starts and there is no clock-in yet.',
  invitationEnable: 'Turn on',
  invitationDismiss: 'Not now',
  error: 'The notifications could not be turned on. Try again.',
} as const;

/** نصوص قسم إشعارات الموبايل (ar). */
export const staffPushAr = {
  unsupported: 'الموبايل ده مش هيوصله إشعارات.',
  storageBlocked: 'المتصفح ده بيمنع التخزين، فالإشعارات مش هتشتغل عليه.',
  installLead: 'علشان توصلك الإشعارات، ضيفي التطبيق للشاشة الرئيسية.',
  installStep1: 'زرار المشاركة (المربع اللي فيه سهم لفوق).',
  installStep2: 'بعدها «إضافة إلى الشاشة الرئيسية».',
  installStep3: 'وبعدها PosPay يتفتح من أيقونته على الشاشة الرئيسية.',
  blocked: 'الإشعارات متقفلة من إعدادات المتصفح. لازم تتفتح من هناك الأول.',
  off: 'إشعارات الموبايل مقفولة.',
  on: 'الإشعارات شغّالة.',
  enable: 'تشغيل إشعارات الموبايل',
  disable: 'إيقاف الإشعارات',
  offline: 'مفيش إنترنت، فتشغيل الإشعارات مش متاح دلوقتي.',
  reconnecting: 'بنتصل تاني…',
  invitationLead: 'يوصلك إشعار على الموبايل ده لو الشيفت بدأ ومفيش بصمة حضور.',
  invitationEnable: 'تشغيل',
  invitationDismiss: 'مش دلوقتي',
  error: 'الإشعارات ما اشتغلتش. ممكن المحاولة تاني بعد شوية.',
} satisfies Record<keyof typeof staffPushEn, string>;
