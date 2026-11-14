import type { PendingPackageSaleRequest } from '../domain/package-sale-request.ts';
import type { DiscountLimitPort, SessionRecordAccessPort } from './session-readers.port.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';

/** منافذ قبول بيع الباقة على معاملة الشركة الواحدة. */
export interface PackageSaleRequestTransaction {
  /** سلطة البيع الحية؛ إعادة قراءتها عند replay تمنع رداً محفوظاً بعد سقوط الإذن. */
  readonly access: SessionRecordAccessPort;
  /** حد العضوية المختارة المجمد مع الطلب ليحكم العامل على الخصم لاحقاً. */
  readonly discountLimit: DiscountLimitPort;
  /**
   * يحفظ رد 202 أو يعيده مع replayed لإعادة التفويض دون تكرار الآثار.
   *
   * @param handler خطوات القبول
   * @returns الجسم وعلامة الإعادة
   */
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يدخل لقطة pending بلا استحقاق.
   *
   * @param request صف القبول
   * @returns اكتمال الإدخال في المعاملة
   */
  insertPending(request: PendingPackageSaleRequest): Promise<void>;
  /**
   * يكتب الحدث بهوية الطلب فقط.
   *
   * @param requestId هوية الطلب
   * @returns اكتمال إدخال PackageSaleRequested في outbox
   */
  publishRequested(requestId: string): Promise<void>;
}

/** حد معاملة قبول البيع؛ الساعة ومولد الهويات يبقيان عند حالة الاستخدام. */
export interface PackageSaleRequestTransactions {
  /**
   * يشغل القبول بهوية المستخدم.
   *
   * @param context النطاق والمفتاح والبصمة
   * @param work خطوات القبول
   * @returns النتيجة بعد نجاح المعاملة
   */
  run<T>(
    context: SessionWriteContext,
    work: (tx: PackageSaleRequestTransaction) => Promise<T>,
  ): Promise<T>;
}
