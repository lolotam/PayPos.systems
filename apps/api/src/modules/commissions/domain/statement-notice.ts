/**
 * يقسم مستلمي إشعار الاعتماد لمجموعات متتالية ما تتجاوز مية، بعد حذف التكرار والترتيب التصاعدي،
 * لأن حدث الجرس بيقبل مية مستلم كحد أقصى (FR-030، ADR-0037 §5). الحجم لازم يكون عدد صحيح موجب.
 *
 * @param userIds معرفات المستخدمين المؤهلين بالصلاحية
 * @param size حجم المجموعة الواحدة، عدد صحيح موجب
 * @returns المجموعات بالترتيب التصاعدي؛ صفر مستلمين يعطي صفر مجموعات
 */
export function groupStatementNoticeRecipients(
  userIds: readonly string[],
  size: number,
): readonly (readonly string[])[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('The statement notice group size must be a positive integer');
  }
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    groups.push(unique.slice(index, index + size));
  }
  return groups;
}

/**
 * مستلمو مجموعة واحدة بصفوف جرس داخل التطبيق: هوية المستخدم والقالب والشهر وحده (FR-030).
 * ولا مبلغ ولا اسم موظفة ولا اسم عميل.
 *
 * @param userIds مستلمو المجموعة
 * @param period شهر الكشف بصيغة YYYY-MM
 * @returns صفوف الجرس جاهزة للحدث
 */
export function statementNoticeRecipients(
  userIds: readonly string[],
  period: string,
): readonly {
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
}[] {
  return userIds.map((user_id) => ({
    channel: 'IN_APP',
    user_id,
    locale: 'ar',
    template_key: 'statement_awaiting_approval',
    template_revision: 1,
    safe_parameters: [{ name: 'period', type: 'text', value: period }],
  }));
}
