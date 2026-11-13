import type {
  LeaveHistoryReportActor,
  LeaveHistoryReportPendingInsert,
  LeaveHistoryReportStoredScope,
} from '../domain/leave-history-report-request.ts';

/** نطاق قبول واحد يحفظ الطلب وحدثه ويقرأ صلاحية صانعه داخل المعاملة نفسها. */
export interface LeaveHistoryReportRequestScope {
  /**
   * يعيد النطاق المجمد بعد إثبات القراءة والميزة والفرع المطلوب أو يرمي رفضاً آمناً.
   *
   * @param branchId فرع اختياري يجب أن يقع داخل نطاق القراءة
   * @returns نطاق الفروع المجمد المطلوب حفظه مع التقرير
   */
  authorize(branchId?: string): Promise<LeaveHistoryReportStoredScope>;
  /**
   * يسلسل طلبات صانع واحد حتى لا يتجاوز التكرار أو العد المتزامنان القواعد.
   *
   * @returns اكتمال القفل داخل معاملة القبول
   */
  lockCreator(): Promise<void>;
  /**
   * يعيد هوية طلب معلق مطابق وغير منتهي المهلة لمنع إدراج وحدث مكررين.
   *
   * @param fingerprintSource النص القانوني للاستعلام والنطاق قبل تجزئته
   * @param now لحظة القبول من Clock
   * @returns هوية الطلب القابل لإعادة الاستخدام أو null
   */
  findReusablePending(fingerprintSource: string, now: Date): Promise<string | null>;
  /**
   * يعد طلبات صانع النشاط المعلقة الحية لفرض سعة العمل المقبولة.
   *
   * @param now لحظة القبول من Clock
   * @returns عدد الطلبات التي لم تنته مهلتها بعد
   */
  countPending(now: Date): Promise<number>;
  /**
   * يدرج طلباً معلقاً باستعلامه ونطاقه ومواعيده المجمدة.
   *
   * @param input مدخل الإدراج الكامل ومصدر بصمته
   * @returns اكتمال إدراج الصف دون حدث مستقل
   */
  createPending(input: LeaveHistoryReportPendingInsert): Promise<void>;
  /**
   * يكتب حدث التقرير الجديد بهويته فقط داخل معاملة إدراجه.
   *
   * @param reportId هوية التقرير الجديد
   * @returns اكتمال كتابة الحدث في outbox
   */
  publishRequested(reportId: string): Promise<void>;
}

/** حد المعاملة الذي يفتح وصول المستأجر ويمرر نطاق القبول لحالة الاستخدام. */
export interface LeaveHistoryReportRequestTransactions {
  /**
   * ينفذ القبول تحت RLS وهوية صانع الطلب ويعيد النتيجة بعد الالتزام فقط.
   *
   * @param actor هوية صانع الطلب المتحقق منها
   * @param work خطوات القبول داخل المعاملة
   * @returns نتيجة القبول بعد نجاح المعاملة
   */
  run<T>(
    actor: LeaveHistoryReportActor,
    work: (scope: LeaveHistoryReportRequestScope) => Promise<T>,
  ): Promise<T>;
}
