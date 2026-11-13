// خدمات الكتالوج — شاشات الإدارة ورسائل الرفض المسمّاة، بالعربي والإنجليزي.
import { serviceCategoryErrorsAr, serviceCategoryErrorsEn } from './catalog-service-categories.js';

export const catalogServicesEn = {
  listTitle: 'Services',
  listLead:
    'The business menu: price, commission rule and whether the service counts toward tiers.',
  empty: 'No services on this page.',
  missingValue: '—',
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
  duration: 'Duration (minutes)',
  durationInvalid: 'Enter a whole number of minutes from 1 to 600.',
  minutesShort: 'min',
  durationColumn: 'Duration',
  category: 'Category',
  categoryColumn: 'Category',
  noCategory: 'No category',
  categoryClosed: 'closed',
  categoriesUnavailable:
    'The category list is not available with your permission; the current category will be kept.',
  categoriesUnavailableNew:
    'The category list is not available with your permission; the service is saved without a category.',
  categoryFilter: 'Filter by category',
  allCategories: 'All categories',
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
  invalid: 'Check the names, the price (3 decimals) and the commission rule value.',
};

export const catalogServicesAr = {
  listTitle: 'الخدمات',
  listLead: 'قائمة خدمات النشاط: السعر وقاعدة العمولة وهل تُحتسب في مجمّع الشرائح.',
  empty: 'لا توجد خدمات في هذه الصفحة.',
  missingValue: '—',
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
  duration: 'المدة (بالدقائق)',
  durationInvalid: 'أدخل عدد دقائق صحيح من 1 إلى 600.',
  minutesShort: 'د',
  durationColumn: 'المدة',
  category: 'التصنيف',
  categoryColumn: 'التصنيف',
  noCategory: 'بدون تصنيف',
  categoryClosed: 'مغلق',
  categoriesUnavailable: 'قائمة التصنيفات غير متاحة بصلاحيتك؛ سيُحتفظ بالتصنيف الحالي.',
  categoriesUnavailableNew: 'قائمة التصنيفات غير متاحة بصلاحيتك؛ ستُحفظ الخدمة بدون تصنيف.',
  categoryFilter: 'تصفية حسب التصنيف',
  allCategories: 'كل التصنيفات',
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
  SERVICE_NAME_INVALID:
    'The English name is required (1–255 characters); the Arabic name is optional.',
  SERVICE_DURATION_INVALID: 'The duration must be a whole number of minutes from 1 to 600.',
  SERVICE_CATEGORY_CLOSED: 'The category of this service is closed.',
  SERVICE_ALREADY_CLOSED: 'The service is already closed.',
  SERVICE_NOT_CLOSED: 'The service is not closed.',
  SERVICE_REVISION_CONFLICT:
    'Another manager changed this service. Reload the latest record before saving.',
};

export const serviceErrorsAr = {
  SERVICE_NOT_FOUND: 'الخدمة غير موجودة في هذا النشاط.',
  SERVICE_COMMISSION_RULE_INVALID:
    'قاعدة العمولة غير صحيحة: النسبة لازم تكون من 0 إلى 10000 نقطة أساس، والمبلغ الثابت قيمة غير سالبة بالدينار.',
  SERVICE_PRICE_INVALID:
    'السعر لازم يكون مبلغ غير سالب بالدينار الكويتي وبثلاث خانات عشرية بالظبط.',
  SERVICE_NAME_INVALID: 'الاسم الإنجليزي مطلوب (1–255 حرفاً)، والاسم العربي اختياري.',
  SERVICE_DURATION_INVALID: 'المدة لازم تكون عدد دقائق صحيح من 1 إلى 600.',
  SERVICE_CATEGORY_CLOSED: 'تصنيف هذه الخدمة مغلق.',
  SERVICE_ALREADY_CLOSED: 'الخدمة مغلقة بالفعل.',
  SERVICE_NOT_CLOSED: 'الخدمة غير مغلقة.',
  SERVICE_REVISION_CONFLICT: 'عدّل مدير آخر هذه الخدمة. أعد تحميل أحدث سجل قبل الحفظ.',
};

// أخطاء الكتالوج كله: الخدمات وتصنيفاتها، في مجموعة واحدة عشان السطر الواحد في en/ar يكفي.
export const catalogServiceErrorsEn = { ...serviceErrorsEn, ...serviceCategoryErrorsEn };
export const catalogServiceErrorsAr = { ...serviceErrorsAr, ...serviceCategoryErrorsAr };
