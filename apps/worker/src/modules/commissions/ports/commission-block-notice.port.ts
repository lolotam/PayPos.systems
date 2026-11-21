/** مُدخلات جرس التوقف: هوية الصف ومجموعته والنشاط وشهر المصدر ومستلمو المجموعة. */
export interface CommissionBlockNoticeInput {
  readonly blockId: string;
  readonly groupIndex: number;
  readonly businessId: string;
  readonly sourcePeriod: string;
  readonly recipients: readonly string[];
}

/**
 * قارئ حاملي صلاحية النشاط، مربوط بالهوية عند جذر التوصيل عشان وحدة العمولات ما تعرفش جداول العضويات (D-16).
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param permission كود الصلاحية
 * @param at لحظة قراءة العضويات والمنح
 * @returns معرفات المستخدمين المؤهلين
 */
export type CommissionPermissionHoldersReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  businessId: string,
  permission: string,
  at: Date,
) => Promise<readonly string[]>;

/**
 * منفذ جرس أصحاب صلاحية خطط العمولة: قراءة المستلمين وكتابة حدث الجرس في
 * معاملة تسجيل التوقف نفسها، فما فيش اتصال خارجي جوّه معاملة (FR-049).
 */
export interface CommissionBlockNotices {
  /**
   * ساعة اللحظة الحالية المحقونة، وقت قراءة المستلمين بلا قفل (ADR-0037 §2).
   *
   * @returns لحظة القراءة
   */
  now(): Date;
  /**
   * يرجع أصحاب صلاحية خطط العمولة على النشاط في اللحظة دي، لأنهم اللي بيصلّحوا
   * التصحيح الموقوف (CS-Q19).
   *
   * @param companyId الشركة
   * @param businessId النشاط
   * @param at لحظة القراءة
   * @returns مجموعات معرفات المستخدمين المؤهلين ضمن حد عقد الحدث
   */
  recipientGroups(
    companyId: string,
    businessId: string,
    at: Date,
  ): Promise<readonly (readonly string[])[]>;
  /**
   * يكتب مجموعة المستلمين كحدث جرس واحد في معاملة التوقف نفسها.
   *
   * @param input هوية الصف والمجموعة والنشاط والشهر والمستلمون
   */
  append(input: CommissionBlockNoticeInput): Promise<void>;
}
