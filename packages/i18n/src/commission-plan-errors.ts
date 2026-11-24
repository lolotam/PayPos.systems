export const commissionPlanErrorsAr = {
  COMMISSION_PERIOD_CLOSED: 'الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.',
  COMMISSION_PERIOD_NOT_DRAFT: 'الشهر ده اتراجع، رجّعه للمسودة الأول.',
  COMMISSION_PLAN_INVALID: 'الخطة دي مش صالحة، راجع إعداداتها.',
  COMMISSION_EFFECTIVE_FROM_PAST: 'تاريخ البداية لازم يكون النهارده أو بعده.',
  COMMISSION_PERIOD_BEFORE_BUSINESS:
    'الشهر ده قبل ما النشاط يبدأ على PosPay، اختار شهر بعد بداية النشاط.',
  COMMISSION_REPAIR_NOT_ALLOWED: 'مفيش تصحيح موقوف بسبب عدم وجود خطة للموظفة دي في الشهر ده.',
  COMMISSION_PERIOD_NOT_ENDED: 'الشهر ده لسه ما خلصش، اعمل الكشف بعد نهايته.',
  COMMISSION_STATEMENT_BLOCKED:
    'الكشف فيه موظفة من غير خطة أو مرتب أو تصحيح موقوف، لازم يتحل قبل المراجعة.',
  COMMISSION_FINGERPRINT_STALE:
    'الكشف اتغيّر بعد ما شفته، راجعه من الأول قبل ما تعتمد.',
  COMMISSION_RETURN_REASON_INVALID:
    'اكتب سبب رجوع الكشف للمراجعة (لحد 500 حرف).',
  COMMISSION_STATEMENT_NOT_REVIEWED: 'الكشف ده مش متراجع، فلازم يرجع للمراجعة الأول.',
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
  COMMISSION_REPAIR_NOT_ALLOWED:
    'There is no plan-missing blocked correction for this employee and month.',
  COMMISSION_PERIOD_NOT_ENDED: 'This month has not ended yet; generate its statement after it ends.',
  COMMISSION_STATEMENT_BLOCKED:
    'The statement has an employee with no plan or salary, or an open blocked correction; resolve it before review.',
  COMMISSION_FINGERPRINT_STALE:
    'The statement changed after you loaded it; load it again before you review it.',
  COMMISSION_RETURN_REASON_INVALID:
    'Enter the reason for returning the statement to review (up to 500 characters).',
  COMMISSION_STATEMENT_NOT_REVIEWED:
    'This statement is not reviewed yet; return it to review first.',
  COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE:
    'The employee list cannot be loaded because stored data needs repair. Contact support.',
  EMPLOYEE_NOT_FOUND: 'The employee was not found in this business.',
} as const;
