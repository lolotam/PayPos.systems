export const commissionPlanErrorsAr = {
  COMMISSION_PERIOD_CLOSED: 'الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.',
  COMMISSION_PERIOD_NOT_DRAFT: 'الشهر ده اتراجع، رجّعه للمسودة الأول.',
  COMMISSION_PLAN_INVALID: 'الخطة دي مش صالحة، راجع إعداداتها.',
  COMMISSION_EFFECTIVE_FROM_PAST: 'تاريخ البداية لازم يكون النهارده أو بعده.',
  COMMISSION_PERIOD_BEFORE_BUSINESS:
    'الشهر ده قبل ما النشاط يبدأ على PosPay، اختار شهر بعد بداية النشاط.',
  COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE:
    'تعذّر تحميل قائمة الموظفين بسبب بيانات محفوظة تحتاج إصلاحًا. تواصل مع الدعم.',
  EMPLOYEE_NOT_FOUND: 'الموظفة غير موجودة في النشاط ده.',
} as const;

export const commissionPlanErrorsEn = {
  COMMISSION_PERIOD_CLOSED:
    'This month is already approved; changes become corrections in the next month.',
  COMMISSION_PERIOD_NOT_DRAFT: 'This month has been reviewed; return it to draft first.',
  COMMISSION_PLAN_INVALID: 'The commission plan is invalid. Check its settings.',
  COMMISSION_EFFECTIVE_FROM_PAST: 'The start date must be today or later.',
  COMMISSION_PERIOD_BEFORE_BUSINESS:
    'This month is before the business started on PosPay; choose a later month.',
  COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE:
    'The employee list cannot be loaded because stored data needs repair. Contact support.',
  EMPLOYEE_NOT_FOUND: 'The employee was not found in this business.',
} as const;
