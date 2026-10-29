export const commissionPlanErrorsAr = {
  COMMISSION_PERIOD_CLOSED: 'الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.',
  COMMISSION_PERIOD_NOT_DRAFT: 'الشهر ده اتراجع، رجّعه للمسودة الأول.',
  COMMISSION_PLAN_INVALID: 'الخطة دي مش صالحة، راجع إعداداتها.',
  COMMISSION_EFFECTIVE_FROM_PAST: 'تاريخ البداية لازم يكون النهارده أو بعده.',
  EMPLOYEE_NOT_FOUND: 'الموظفة غير موجودة في النشاط ده.',
} as const;

export const commissionPlanErrorsEn = {
  COMMISSION_PERIOD_CLOSED:
    'This month is already approved; changes become corrections in the next month.',
  COMMISSION_PERIOD_NOT_DRAFT: 'This month has been reviewed; return it to draft first.',
  COMMISSION_PLAN_INVALID: 'The commission plan is invalid. Check its settings.',
  COMMISSION_EFFECTIVE_FROM_PAST: 'The start date must be today or later.',
  EMPLOYEE_NOT_FOUND: 'The employee was not found in this business.',
} as const;
