// خدمات الكتالوج — شاشات الإدارة ورسائل الرفض المسمّاة، بالعربي والإنجليزي.
export const catalogServicesEn = {
  listTitle: 'Services',
  listLead: 'The business menu: price, commission rule and whether the service counts toward tiers.',
  empty: 'No services on this page.',
  create: 'Add service',
  title: 'Add service',
  editTitle: 'Edit service',
  edit: 'Edit',
  save: 'Save changes',
  created: 'Service created:',
  saved: 'Service updated.',
  nameEn: 'English name',
  nameAr: 'Arabic name (optional)',
  price: 'Price (KWD, 3 decimals)',
  rule: 'Commission rule',
  ruleFollowPlan: 'Follow plan',
  ruleZero: 'No commission',
  rulePct: 'Percentage',
  ruleFixed: 'Fixed amount (KWD)',
  ruleBps: 'Percentage (basis points, 0–10000)',
  countsTowardThreshold: 'Counts toward accumulation',
  countsYes: 'Counts',
  countsNo: 'Does not count',
  next: 'Next page',
  first: 'First page',
  reload: 'Reload service',
  cancel: 'Back to services',
  invalid:
    'Check the names, the price (3 decimals) and the commission rule value.',
};

export const catalogServicesAr = {
  listTitle: 'الخدمات',
  listLead: 'قائمة خدمات النشاط: السعر وقاعدة العمولة وهل تُحتسب في مجمّع الشرائح.',
  empty: 'لا توجد خدمات في هذه الصفحة.',
  create: 'إضافة خدمة',
  title: 'إضافة خدمة',
  editTitle: 'تعديل الخدمة',
  edit: 'تعديل',
  save: 'حفظ التعديلات',
  created: 'تمت إضافة الخدمة:',
  saved: 'تم تعديل الخدمة.',
  nameEn: 'الاسم بالإنجليزية',
  nameAr: 'الاسم بالعربية (اختياري)',
  price: 'السعر (دينار كويتي، ٣ خانات عشرية)',
  rule: 'قاعدة العمولة',
  ruleFollowPlan: 'حسب الخطة',
  ruleZero: 'بدون عمولة',
  rulePct: 'نسبة مئوية',
  ruleFixed: 'مبلغ ثابت (دينار كويتي)',
  ruleBps: 'النسبة (نقاط أساس، 0–10000)',
  countsTowardThreshold: 'تُحتسب في المجمّع',
  countsYes: 'تُحتسب',
  countsNo: 'لا تُحتسب',
  next: 'الصفحة التالية',
  first: 'الصفحة الأولى',
  reload: 'إعادة تحميل الخدمة',
  cancel: 'العودة إلى الخدمات',
  invalid: 'راجع الأسماء والسعر (٣ خانات عشرية) وقيمة قاعدة العمولة.',
};

export const serviceErrorsEn = {
  SERVICE_NOT_FOUND: 'The service does not exist in this business.',
  SERVICE_COMMISSION_RULE_INVALID:
    'The commission rule is not valid: percentage must be 0–10000 basis points and a fixed amount must be a nonnegative KWD value.',
  SERVICE_PRICE_INVALID: 'The price must be a nonnegative KWD amount with exactly 3 decimals.',
  SERVICE_NAME_INVALID: 'The English name is required (1–255 characters); the Arabic name is optional.',
  SERVICE_REVISION_CONFLICT: 'Another manager changed this service. Reload the latest record before saving.',
};

export const serviceErrorsAr = {
  SERVICE_NOT_FOUND: 'الخدمة غير موجودة في هذا النشاط.',
  SERVICE_COMMISSION_RULE_INVALID:
    'قاعدة العمولة غير صحيحة: النسبة لازم تكون من 0 إلى 10000 نقطة أساس، والمبلغ الثابت قيمة غير سالبة بالدينار.',
  SERVICE_PRICE_INVALID: 'السعر لازم يكون مبلغ غير سالب بالدينار الكويتي وبثلاث خانات عشرية بالظبط.',
  SERVICE_NAME_INVALID: 'الاسم الإنجليزي مطلوب (1–255 حرفاً)، والاسم العربي اختياري.',
  SERVICE_REVISION_CONFLICT: 'عدّل مدير آخر هذه الخدمة. أعد تحميل أحدث سجل قبل الحفظ.',
};
