export const personalStaffEn = {
  title: 'Personal staff sign-in',
  lead: 'Use your own phone to register your fingerprint, face or screen lock.',
  linkRequired: 'Ask your manager for your personal sign-in link.',
  enrol: 'Register a passkey',
  bound: 'Your passkey is registered. Replacement requires your manager to unbind it first.',
  unbound: 'Register your passkey on this phone.',
  signOut: 'Sign out',
  retry: 'Start again',
  personalLink: 'Personal staff sign-in',
  loading: 'Checking your session…',
  offline: 'Reconnect to sign in or register a passkey.',
} as const;

export const personalStaffAr = {
  title: 'دخول الموظف من هاتفه الشخصي',
  lead: 'استخدم هاتفك الشخصي لتسجيل البصمة أو الوجه أو رمز قفل الشاشة.',
  linkRequired: 'اطلب من المدير رابط الدخول الشخصي الخاص بنشاطك.',
  enrol: 'تسجيل مفتاح مرور',
  bound: 'تم تسجيل مفتاح المرور. لتغييره اطلب من المدير فك الربط أولاً.',
  unbound: 'سجل مفتاح المرور من هذا الهاتف.',
  signOut: 'تسجيل الخروج',
  retry: 'البدء من جديد',
  personalLink: 'دخول الموظف الشخصي',
  loading: 'جارٍ التحقق من الجلسة…',
  offline: 'اتصل بالإنترنت للدخول أو تسجيل مفتاح المرور.',
} satisfies Record<keyof typeof personalStaffEn, string>;
