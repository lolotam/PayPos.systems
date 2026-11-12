// سياق محلي يمنع اعتماد حزمة قاعدة البيانات على عقود API مع قبول سياق القراءة الحالي.
export type LeaveHistoryContext = {
  companyId: string;
  userId: string;
  businessId: string;
  own: boolean;
  branchId?: string;
  employeeId?: string;
  purpose?: 'history';
};

// حقول الاستعلام التي يقرأها الباني فقط تحفظ توافق العقد من غير ربط الحزمة به.
export type LeaveHistoryBuilderQuery = {
  from: string;
  to: string;
  'types[]': string[];
  'statuses[]': string[];
  branch_id?: string | undefined;
  limit: number;
};

// حقول الترتيب وحدها تكفي الباني بينما يحتفظ API بوقت اللقطة في مؤشره الأكمل.
export type LeaveHistoryCursor = {
  date: string;
  rank: number;
  id: string;
};

// خيار الرؤية مستقل عن قارئ API لأن العامل يعيد استخدام الباني نفسه.
export type LeaveHistoryReportOptions = {
  attachment: 'current' | 'any';
};
