/**
 * تغيير حساس لازم يتسجل في الـ audit trail (CLAUDE.md §8).
 */
export interface AuditRecord {
  /** اسم الكيان بـ snake_case (price, membership, payment). */
  readonly entity: string;
  readonly entityId: string;
  /** snake_case مع نقط: created, price.changed. */
  readonly action: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * بيسجّل التغيير جوه نفس transaction الـ use case — الشركة والمستخدم بييجوا من الـ context مش من هنا.
 */
export interface AuditTrail {
  /**
   * بيضيف السجل؛ أي سر في before/after بيتشال قبل ما يتكتب، والسجل بيفضل للأبد.
   *
   * @param entry الكيان والعملية والحالة قبل وبعد
   * @returns بيخلص لما السجل يتكتب في الـ transaction
   */
  record(entry: AuditRecord): Promise<void>;
}
