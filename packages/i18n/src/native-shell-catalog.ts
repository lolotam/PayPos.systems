/** شاشة بداية التطبيق الأصلي: اختيار نوع الجهاز قبل أي شاشة تانية (spec 065). */
export const nativeShellEn = {
  title: 'How do you use this device?',
  lead: 'Choose how this device is used at the salon: the counter, or your own employee account.',
  counter: 'Counter device',
  counterHint: 'A tablet or the salon phone: the cashier and staff attendance.',
  employee: 'My employee account',
  employeeHint: 'Your own phone: your sign-in and your attendance.',
  needsInternet: 'The first time needs the internet.',
  saveFailed: 'The choice could not be saved. Try again.',
  pasteLabel: 'Paste the link your manager sent you',
  pasteSubmit: 'Connect',
  otherBusiness: 'This device is connected to another salon',
  counterDevice: 'This device is a counter device, and the link is for an employee',
} as const;

/** نفس مفاتيح شاشة البداية بالعربي. */
export const nativeShellAr: Record<keyof typeof nativeShellEn, string> = {
  title: 'إنت بتستخدم الجهاز ده إزاي؟',
  lead: 'اختار الجهاز ده بيتستخدم إزاي في الصالون: كاونتر، ولا حسابك كموظفة.',
  counter: 'جهاز الكاونتر',
  counterHint: 'تابلت أو تليفون الصالون: الكاشير وحضور الموظفين',
  employee: 'حسابي كموظفة',
  employeeHint: 'تليفونك إنت: دخولك وحضورك',
  needsInternet: 'أول مرة محتاجة نت',
  saveFailed: 'مقدرناش نحفظ الاختيار ده. حاول تاني.',
  pasteLabel: 'الصقي اللينك اللي بعتهولك المدير',
  pasteSubmit: 'وصّلي',
  otherBusiness: 'الجهاز ده متوصّل بصالون تاني',
  counterDevice: 'الجهاز ده جهاز كاونتر، واللينك ده لحساب موظفة',
};
