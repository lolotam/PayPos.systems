export const catalogPackageTypesEn = {
  listTitle: 'Package types',
  listLead: 'Packages available across all branches of this business.',
  empty: 'No package types on this page.',
  create: 'Add package type',
  title: 'Add package type',
  editTitle: 'Edit package type',
  edit: 'Edit',
  save: 'Save changes',
  created: 'Package type created:',
  saved: 'Package type updated.',
  nameEn: 'English name',
  nameAr: 'Arabic name (optional)',
  price: 'Price (KWD, 3 decimals)',
  validity: 'Validity (days)',
  componentCount: 'Services',
  validityHelp:
    'Usable through the end of the sale date + validity days, in branch time. Sold on 1 October with 30 days: usable through 31 October.',
  snapshotHelp:
    'Changes apply to future sales. Existing customers keep their purchased sessions, values and expiry.',
  freeWarning:
    'A service priced 0.000 has sessions worth 0.000, unless every service in the package is free.',
  components: 'Package services',
  service: 'Service',
  sessions: 'Sessions',
  addComponent: 'Add service',
  removeComponent: 'Remove service',
  removeComponentRow: 'Remove service {row}',
  selectService: 'Choose a service',
  nextServices: 'Load more services',
  serviceOptionsForbidden:
    'To choose package services, your role needs read:package-types:business. Ask an administrator to grant it.',
  next: 'Next page',
  first: 'First page',
  reload: 'Reload package type',
  cancel: 'Back to package types',
  invalid:
    'Check names, price (3 decimals), validity (1–730 days), and 1–20 distinct services with 1–365 sessions each.',
};
export const catalogPackageTypesAr = {
  serviceOptionsForbidden:
    'لاختيار خدمات الباقة، يحتاج دورك إلى الصلاحية read:package-types:business. اطلب من مسؤول الصلاحيات إضافتها.',
  listTitle: 'أنواع الباقات',
  listLead: 'الباقات المتاحة في جميع فروع هذا النشاط.',
  empty: 'لا توجد أنواع باقات في هذه الصفحة.',
  create: 'إضافة نوع باقة',
  title: 'إضافة نوع باقة',
  editTitle: 'تعديل نوع الباقة',
  edit: 'تعديل',
  save: 'حفظ التعديلات',
  created: 'تمت إضافة نوع الباقة:',
  saved: 'تم تعديل نوع الباقة.',
  nameEn: 'الاسم بالإنجليزية',
  nameAr: 'الاسم بالعربية (اختياري)',
  price: 'السعر (دينار كويتي، ٣ خانات عشرية)',
  validity: 'الصلاحية بالأيام',
  componentCount: 'الخدمات',
  validityHelp:
    'صالحة حتى نهاية تاريخ البيع زائد أيام الصلاحية بتوقيت الفرع. البيع يوم ١ أكتوبر بصلاحية ٣٠ يوماً: الاستخدام حتى نهاية ٣١ أكتوبر.',
  snapshotHelp:
    'التعديلات تسري على المبيعات الجديدة. العملاء السابقون يحتفظون بجلساتهم وقيمها وتاريخ انتهائها.',
  freeWarning: 'جلسات الخدمة ذات السعر 0.000 قيمتها 0.000، إلا إذا كانت كل خدمات الباقة مجانية.',
  components: 'خدمات الباقة',
  service: 'الخدمة',
  sessions: 'الجلسات',
  addComponent: 'إضافة خدمة',
  removeComponent: 'إزالة الخدمة',
  removeComponentRow: 'إزالة الخدمة {row}',
  selectService: 'اختر خدمة',
  nextServices: 'تحميل المزيد من الخدمات',
  next: 'الصفحة التالية',
  first: 'الصفحة الأولى',
  reload: 'إعادة تحميل نوع الباقة',
  cancel: 'العودة إلى أنواع الباقات',
  invalid:
    'راجع الأسماء والسعر بثلاث خانات والصلاحية من ١ إلى ٧٣٠ يوماً، ومن ١ إلى ٢٠ خدمة مختلفة لكل منها من ١ إلى ٣٦٥ جلسة.',
};
export const packageTypeErrorsEn = {
  PACKAGE_TYPE_NOT_FOUND: 'The package type does not exist in this business.',
  PACKAGE_TYPE_INVALID_COMPONENTS: 'A package must contain 1–20 services.',
  PACKAGE_TYPE_DUPLICATE_SERVICE: 'Each service may appear only once in a package.',
  PACKAGE_TYPE_INVALID_SESSIONS: 'Sessions must be a whole number from 1 to 365.',
  PACKAGE_TYPE_PRICE_INVALID:
    'Price must be from 0.000 to 99999999999.999 KWD with exactly 3 decimals.',
  PACKAGE_TYPE_VALIDITY_INVALID: 'Validity must be a whole number from 1 to 730 days.',
  PACKAGE_TYPE_SERVICE_NOT_FOUND: 'A selected service does not exist in this business.',
  PACKAGE_TYPE_NAME_TAKEN: 'A package type with this name already exists in this business.',
  PACKAGE_TYPE_NAME_INVALID:
    'Use 1–255 characters for each supplied name; the English name is required.',
  PACKAGE_TYPE_REVISION_CONFLICT:
    'Another manager changed this package type. Reload before saving.',
};
export const packageTypeErrorsAr = {
  PACKAGE_TYPE_NOT_FOUND: 'نوع الباقة غير موجود في هذا النشاط.',
  PACKAGE_TYPE_INVALID_COMPONENTS: 'يجب أن تحتوي الباقة على خدمة واحدة إلى ٢٠ خدمة.',
  PACKAGE_TYPE_DUPLICATE_SERVICE: 'لا يمكن تكرار نفس الخدمة في الباقة.',
  PACKAGE_TYPE_INVALID_SESSIONS: 'عدد الجلسات يجب أن يكون عدداً صحيحاً من ١ إلى ٣٦٥.',
  PACKAGE_TYPE_PRICE_INVALID:
    'السعر يجب أن يكون من 0.000 إلى 99999999999.999 دينار وبثلاث خانات عشرية.',
  PACKAGE_TYPE_VALIDITY_INVALID: 'الصلاحية يجب أن تكون عدداً صحيحاً من ١ إلى ٧٣٠ يوماً.',
  PACKAGE_TYPE_SERVICE_NOT_FOUND: 'إحدى الخدمات المختارة غير موجودة في هذا النشاط.',
  PACKAGE_TYPE_NAME_TAKEN: 'يوجد نوع باقة بنفس الاسم في هذا النشاط.',
  PACKAGE_TYPE_NAME_INVALID: 'كل اسم مدخل من ١ إلى ٢٥٥ حرفاً؛ الاسم الإنجليزي مطلوب.',
  PACKAGE_TYPE_REVISION_CONFLICT: 'عدّل مدير آخر نوع الباقة. أعد التحميل قبل الحفظ.',
};
