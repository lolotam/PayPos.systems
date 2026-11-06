export const myLeaveEn = {
  title: 'My leave',
  chooseBranch: 'Choose a branch',
  noBranches: 'No eligible branches',
  offline: 'Internet required. Leave data is not kept offline.',
  invalid:
    'Check the dates and times. Full days: at most 90 inclusive days. Partial day: increasing times on 15-minute steps. Other requires a note (at most 500 characters).',
  failed: 'Unable to load or save leave. Try again.',
  retry: 'Retry',
  latestRequest: 'Latest request',
};
export const myLeaveAr: Record<keyof typeof myLeaveEn, string> = {
  title: 'إجازاتي',
  chooseBranch: 'اختاري الفرع',
  noBranches: 'لا توجد فروع متاحة',
  offline: 'محتاج إنترنت. بيانات الإجازات لا تُحفظ بدون اتصال.',
  invalid:
    'راجعي التواريخ والأوقات. الأيام الكاملة بحد أقصى 90 يوماً شامل البداية والنهاية. الإجازة الجزئية بأوقات متزايدة كل 15 دقيقة. النوع أخرى يحتاج ملاحظة بحد أقصى 500 حرف.',
  failed: 'تعذر عرض الإجازات أو حفظها. حاولي مرة أخرى.',
  retry: 'حاولي مرة أخرى',
  latestRequest: 'آخر طلب',
};
