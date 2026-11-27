/** صف جرس داخل التطبيق لمستخدم واحد: هويته والقالب والشهر وحده. */
export interface StatementNoticeRecipient {
  readonly channel: 'IN_APP';
  readonly user_id: string;
  readonly locale: 'ar';
  readonly template_key: 'statement_awaiting_approval';
  readonly template_revision: 1;
  readonly safe_parameters: readonly {
    readonly name: 'period';
    readonly type: 'text';
    readonly value: string;
  }[];
}

/**
 * مستلم واحد بصف جرس داخل التطبيق: هوية المستخدم والقالب والشهر وحده (FR-030).
 * ولا مبلغ ولا اسم موظفة ولا اسم عميل.
 *
 * @param userId المستخدم المؤهل بالصلاحية
 * @param period شهر الكشف بصيغة YYYY-MM
 * @returns صف الجرس جاهز للحدث
 */
export function statementNoticeRecipient(userId: string, period: string): StatementNoticeRecipient {
  return {
    channel: 'IN_APP',
    user_id: userId,
    locale: 'ar',
    template_key: 'statement_awaiting_approval',
    template_revision: 1,
    safe_parameters: [{ name: 'period', type: 'text', value: period }],
  };
}
