/** عملية الكتابة التي يؤكدها المستدعي على إثباته. */
export type SessionRecoveryConfirmOperation = 'record-service-session' | 'append-service-session-lines';

/** حقول التأكيد؛ المفتاح الخام يُهاش في الـ adapter ولا يدخل التدقيق. */
export interface SessionRecoveryConfirm {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  operation: SessionRecoveryConfirmOperation;
  key: string;
  outcome: 'RECORDED_ELSEWHERE' | 'NOT_RECORDED';
  at: Date;
  auditId: string;
}

/** إلغاء الإثبات معزول عن مسار الإصدار حتى لا يمس أعمدة الربط. */
export interface SessionRecoveryConfirmPort {
  /**
   * يلغي إثبات المستدعية فقط ويكتب التدقيق عند أول تأكيد.
   *
   * @param input هوية المحاولة ونتيجتها ووقت الإلغاء ومعرف التدقيق؛ المفتاح الخام يُهاش ولا يُخزَّن
   * @returns يكتمل بعد أول إلغاء أو بلا أثر إن لم يوجد إثبات مفتوح للإلغاء
   */
  confirm(input: SessionRecoveryConfirm): Promise<void>;
}
