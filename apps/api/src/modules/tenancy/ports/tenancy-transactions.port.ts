import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';

/**
 * business جديد زي ما الـ use case بيسجله — الشركة جاية من الـ transaction نفسها مش من هنا.
 */
export interface NewBusiness {
  readonly id: string;
  readonly verticalType: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly settings: Record<string, unknown>;
}

/**
 * فرع جديد تحت business في نفس الشركة.
 */
export interface NewBranch {
  readonly id: string;
  readonly businessId: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly addressAr: string | null;
  readonly addressEn: string | null;
  readonly geo: { lat: number; lng: number } | null;
  readonly openingHours: unknown;
}

/**
 * الكتّاب المربوطين بـ transaction واحدة جوه الشركة المتأكد منها.
 */
export interface TenancyScope {
  readonly companyId: string;
  readonly audit: AuditTrail;
  readonly outbox: OutboxWriter;
  /**
   * بيضيف الـ business ويرجّع وقت الإنشاء (ISO زي ما Postgres كتبه، نفس نص القراءة).
   *
   * @param business الـ business الجديد
   */
  insertBusiness(business: NewBusiness): Promise<{ createdAt: string }>;
  /**
   * بيضيف الفرع ويرجّع وقت الإنشاء (ISO زي ما Postgres كتبه) — الـ FK المركّب بيرفض business شركة تانية.
   *
   * @param branch الفرع الجديد
   */
  insertBranch(branch: NewBranch): Promise<{ createdAt: string }>;
}

/**
 * الرد اللي بيتخزن مع مفتاح الـ idempotency.
 */
export interface StoredResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * بيفتح withTenant للشركة المتأكد منها ويعمل claim للمفتاح في نطاق COMPANY قبل أي كتابة (plan v4 T7).
 */
export interface TenancyTransactions {
  /**
   * بينفّذ الشغل مرة واحدة لكل مفتاح؛ الطلب المتعاد بنفس الشكل بياخد الرد المتخزن.
   *
   * @param context             الشركة والمستخدم والعملية
   * @param context.companyId   الشركة اللي الـ guard اتأكد منها
   * @param context.userId      المستخدم اللي بيعمل التغيير
   * @param context.operation   اسم العملية (kebab-case) — جزء من مفتاح الـ idempotency
   * @param idempotency             المفتاح والـ fingerprint
   * @param idempotency.key         الـ Idempotency-Key
   * @param idempotency.fingerprint sha256 للطلب
   * @param work                الكتابة نفسها جوه نفس الـ transaction
   */
  run(
    context: { companyId: string; userId: string; operation: string },
    idempotency: { key: string; fingerprint: string },
    work: (scope: TenancyScope) => Promise<StoredResult>,
  ): Promise<StoredResult & { replayed: boolean }>;
}

/**
 * إعدادات كل vertical — config مش كود (PRD §7.1).
 */
export interface VerticalTemplates {
  /**
   * الـ template اللي بيتنسخ في settings للـ vertical ده.
   *
   * @param vertical نوع الـ business
   */
  settingsFor(vertical: string): Record<string, unknown>;
}
