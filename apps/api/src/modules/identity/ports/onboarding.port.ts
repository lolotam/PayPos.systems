import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';

declare const TRANSACTION: unique symbol;

/**
 * الـ transaction اللي الـ onboarding شغال جواها — نوع مقفول: الـ use case بيعدّيها للـ ports ومبيعرفش جواها إيه.
 */
export type Transaction = { readonly [TRANSACTION]: true };

/**
 * الشركة الجديدة زي ما الـ use case بيسجلها — الـ id جاي من withNewTenant.
 */
export interface NewCompany {
  readonly id: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly ownerUserId: string;
  readonly planId: string;
}

/**
 * كل اللي الـ onboarding محتاجه جوه الـ transaction الواحدة: الـ id الجديد، والكتّاب المربوطين بيها.
 */
export interface OnboardingScope {
  readonly tx: Transaction;
  /** الـ id اللي withNewTenant ولّده — الـ client عمره ما بيبعته. */
  readonly companyId: string;
  readonly audit: AuditTrail;
  readonly outbox: OutboxWriter;
  /**
   * هل الـ plan موجود — عشان plan غلط يترفض برسالة واضحة بدل خطأ FK.
   *
   * @param planId الـ plan اللي في الطلب
   */
  planExists(planId: string): Promise<boolean>;
  /**
   * بيضيف عضوية الـ Owner الأولى على مستوى الشركة — من غيرها الشركة متتشافش (ADR-0003 §5.3).
   *
   * @param membershipId id العضوية الجديدة
   * @param userId       اليوزر اللي بيعمل الشركة
   */
  addOwnerMembership(membershipId: string, userId: string): Promise<void>;
}

/**
 * الرد اللي بيتخزن مع مفتاح الـ idempotency وبيرجع زي ما هو لو الطلب اتعاد.
 */
export interface StoredResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * بيفتح transaction الـ onboarding: withNewTenant (id جديد، app.user_id = المستخدم) ثم claim للمفتاح في نطاق USER
 * قبل أي كتابة (ADR-0003 §3).
 */
export interface OnboardingTransactions {
  /**
   * بينفّذ الشغل مرة واحدة لكل مفتاح؛ لو المفتاح اتعاد بنفس الطلب بيرجّع الرد المتخزن من غير ما يشغّله.
   *
   * @param userId      المستخدم اللي الـ session اتأكدت له
   * @param idempotency المفتاح والـ fingerprint بتوع الطلب
   * @param idempotency.key         الـ Idempotency-Key زي ما الـ client بعته
   * @param idempotency.fingerprint sha256 للطلب — نفس المفتاح بطلب مختلف بيترفض
   * @param work        الكتابة نفسها، جوه نفس الـ transaction
   */
  run(
    userId: string,
    idempotency: { key: string; fingerprint: string },
    work: (scope: OnboardingScope) => Promise<StoredResult>,
  ): Promise<StoredResult & { replayed: boolean }>;
}
