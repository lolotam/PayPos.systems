import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';

/**
 * جهاز فرع زي ما الـ use cases بتشوفه — الـ hashes بس، عمر السر نفسه ما بيتخزن.
 */
export interface DeviceRecord {
  readonly id: string;
  readonly branchId: string;
  readonly label: string;
  readonly status: 'PENDING' | 'ACTIVE' | 'REVOKED';
  readonly claimHash: string | null;
  readonly tokenHash: string | null;
  readonly tokenExpiresAt: Date | null;
}

/**
 * الكتّاب والقرايات المربوطين بـ transaction واحدة جوه شركة الجهاز.
 */
export interface DeviceScope {
  readonly companyId: string;
  readonly audit: AuditTrail;
  readonly outbox: OutboxWriter;
  /**
   * بيجيب الجهاز في الشركة دي ويقفل الصف لحد آخر الـ transaction، أو null لو مش موجود فيها.
   *
   * @param deviceId الجهاز
   */
  findForUpdate(deviceId: string): Promise<DeviceRecord | null>;
  /**
   * بيضيف جهاز جديد PENDING ومعاه hash سر الاستلام.
   *
   * @param device الـ id والفرع والاسم وبيانات الجهاز وhash سر الاستلام
   * @param device.id          id الجهاز الجديد
   * @param device.branchId    الفرع اللي كود الـ pairing اتعمل ليه
   * @param device.label       الاسم اللي هيظهر للـ manager
   * @param device.fingerprint اللي الجهاز بيقوله عن نفسه
   * @param device.appVersion  نسخة الـ POS
   * @param device.claimHash   hash سر الاستلام
   */
  insertPending(device: {
    id: string;
    branchId: string;
    label: string;
    fingerprint: string | null;
    appVersion: string | null;
    claimHash: string;
  }): Promise<void>;
  /**
   * بيحفظ حالة الجهاز الجديدة — الـ use case هو اللي قرر الانتقال، والـ CHECK في الداتابيز بيرفض أي حالة مش متسقة.
   *
   * @param deviceId الجهاز
   * @param change   الحقول اللي اتغيرت
   */
  update(deviceId: string, change: DeviceChange): Promise<void>;
}

/**
 * الحقول اللي بتتغير في انتقال حالة واحد.
 */
export interface DeviceChange {
  readonly status?: 'ACTIVE' | 'REVOKED';
  readonly claimHash?: null;
  readonly tokenHash?: string | null;
  readonly tokenExpiresAt?: Date | null;
  readonly approvedBy?: string;
  readonly approvedAt?: Date;
  readonly revokedBy?: string;
  readonly revokedAt?: Date;
  readonly lastSeenAt?: Date;
}

/**
 * بيفتح transaction في شركة الجهاز (withTenant) — الشركة جاية من كود الـ pairing أو من التوكن، والـ RLS بيخبّي أي
 * جهاز شركة تانية، فشركة مزورة ملهاش صف.
 */
export interface DeviceTransactions {
  /**
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيعمل التغيير، أو null لما الجهاز نفسه هو اللي بيكلّم
   * @param work      الشغل جوه الـ transaction
   */
  run<T>(
    companyId: string,
    userId: string | null,
    work: (scope: DeviceScope) => Promise<T>,
  ): Promise<T>;
}

/**
 * أسرار الأجهزة — الـ adapter بينادي packages/auth، الوحيد اللي بيعمل أسرار ويتأكد منها (CLAUDE.md §8).
 */
export interface DeviceSecrets {
  /** سر جديد عشوائي. */
  newSecret(): string;
  /**
   * الـ hash اللي بيتخزن بدل السر.
   *
   * @param secret السر
   */
  hash(secret: string): string;
  /**
   * مقارنة constant-time مع الـ hash المتخزن.
   *
   * @param secret السر اللي جه في الطلب
   * @param stored الـ hash المتخزن
   */
  verify(secret: string, stored: string | null): boolean;
  /**
   * بيكتب التوكن اللي بيتسلم للجهاز مرة واحدة.
   *
   * @param token الشركة والجهاز والسر
   * @param token.companyId الشركة
   * @param token.deviceId  الجهاز
   * @param token.secret    السر
   */
  format(token: { companyId: string; deviceId: string; secret: string }): string;
  /**
   * بيفك التوكن من غير أي داتابيز، أو null لو شكله غلط.
   *
   * @param token التوكن زي ما جه
   */
  parse(token: string): { companyId: string; deviceId: string; secret: string } | null;
}

/**
 * أكواد الـ pairing — مرة واحدة، و10 دقايق (قرار Waleed 2026-09-23)، في Redis.
 */
export interface PairingCodes {
  /**
   * كود جديد لفرع — الـ manager بيكتبه على الجهاز.
   *
   * @param target الشركة والفرع
   * @param target.companyId الشركة المتأكد منها
   * @param target.branchId  الفرع اللي الجهاز هيتبعه
   */
  issue(target: {
    companyId: string;
    branchId: string;
  }): Promise<{ code: string; expiresAt: Date }>;
  /**
   * بيستهلك الكود مرة واحدة: بيرجّع الشركة والفرع ويمسحه، أو null لو مش موجود أو خلص.
   *
   * @param code الكود زي ما الجهاز بعته
   */
  consume(code: string): Promise<{ companyId: string; branchId: string } | null>;
}
