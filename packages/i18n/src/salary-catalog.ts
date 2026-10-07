// نصوص المرتب الأساسي في شاشة الموظف، منفصلة ليبقى en.ts وar.ts تحت حد الأسطر.

/** نصوص قسم المرتب (en). */
export const salaryEn = {
  title: 'Monthly basic salary',
  lead: 'Basic salary only, without allowances or overtime. Setting the same date replaces its entry.',
  date: 'Effective from',
  amount: 'Monthly basic salary (KWD, 3 decimals)',
  reason: 'Reason',
  revision: 'Revision',
  set: 'Set salary',
  saved: 'Salary saved.',
  invalid:
    'Enter a valid date, a nonnegative KWD amount with 3 decimals and a reason (1–500 characters).',
  readPermission: 'Read salary history',
  managePermission: 'Set salary',
  employeeAccessHint:
    'Salaries are managed from the employee screen and also require employee-management access.',
};

/** نصوص قسم المرتب (ar). */
export const salaryAr = {
  title: 'الراتب الأساسي الشهري',
  lead: 'الراتب الأساسي فقط، بدون بدلات أو عمل إضافي. تعيين نفس التاريخ يستبدل سجله.',
  date: 'يسري من',
  amount: 'الراتب الأساسي الشهري (د.ك، ٣ خانات)',
  reason: 'السبب',
  revision: 'النسخة',
  set: 'تعيين الراتب',
  saved: 'تم حفظ الراتب.',
  invalid: 'أدخل تاريخًا صحيحًا ومبلغًا غير سالب بثلاث خانات عشرية وسببًا من ١ إلى ٥٠٠ حرف.',
  readPermission: 'قراءة سجل الرواتب',
  managePermission: 'تعيين الراتب',
  employeeAccessHint: 'تُدار الرواتب من شاشة الموظفين، وتحتاج أيضًا إلى صلاحية إدارة الموظفين.',
};
