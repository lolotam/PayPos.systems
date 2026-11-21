import type { LockedCommissionPeriod } from '../domain/commission-line-types.ts';
import type { CommissionSaleProjectionRow } from '../domain/commission-sale-inputs.ts';
import type {
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
} from './commission-line-projection.port.ts';

export type {
  Clock,
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
  IdGenerator,
} from './commission-line-projection.port.ts';

export interface CommissionSaleProjectionWrite extends CommissionSaleProjectionRow {
  readonly id: string;
}

export interface CommissionSaleProjectionScope {
  /**
   * يقفل هوية البيع قبل قراءة مراجعته حتى تتسلسل تحديثات البيع والمرتجعات المتسابقة (FR-015).
   *
   * @param saleId هوية بيع الباقة صاحبة الصف
   */
  lockSale(saleId: string): Promise<void>;
  /**
   * يرجع صف البيع المحفوظ للمخفّض ولحساب شهر النسخة القديمة قبل استبدالها.
   *
   * @param saleId هوية البيع المطلوب قراءته بحساب الشركة الحالية
   */
  readSale(saleId: string): Promise<CommissionSaleProjectionRow | null>;
  /**
   * يرجع منطقة النشاط لحساب الشهر الحالي، أو null لإيقاف الإسقاط لنشاط مجهول.
   *
   * @param companyId هوية الشركة صاحبة البيع
   * @param businessId هوية النشاط المطلوب قراءة منطقته الزمنية
   */
  businessTimeZone(companyId: string, businessId: string): Promise<string | null>;
  /**
   * يقفل الشهور المتأثرة والمرشحة ويرجع حالاتها المؤكدة قبل أي كتابة.
   *
   * @param input النشاط والشهور ومولّد هويات الكشوف الجديدة
   */
  lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]>;
  /**
   * يدرج صف البيع أو يستبدل أعمدته المشتقة من الحدث بهوية صف محقونة.
   *
   * @param row صف البيع الأحدث وهوية الصف المولّدة للإدراج
   */
  upsertSale(row: CommissionSaleProjectionWrite): Promise<void>;
  /**
   * يرجع شهور REVIEWED المتأثرة فقط إلى DRAFT بعد تغيّر مدخلاتها (D-5).
   *
   * @param input النشاط والشهور المتأثرة المطلوب إعادة فتحها
   */
  reopenReviewed(input: CommissionPeriodReopenInput): Promise<void>;
}
