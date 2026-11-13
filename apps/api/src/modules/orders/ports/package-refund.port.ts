import type { Money } from '@pospay/domain';
import type { PackageSlot } from '../domain/package-slots.ts';
import type { PackageSaleChangedPayload } from '../domain/package-sale-changed.ts';
import type { SessionWriteContext } from './service-session-transactions.port.ts';

/** سلطة الاسترداد بعد الأقفال؛ can_read محفوظ للمستهلك ولا يدخل في قرار الكتابة. */
export interface PackageRefundAccessFacts {
  denied: boolean;
  feature: boolean;
  can_read: boolean;
  eligible: readonly string[];
}

/** حقائق الاستحقاق المقفول المشتركة بين المباع والمستورد. */
export interface LockedRefundEntitlementBase {
  business_id: string;
  expires_on: string;
  refunded_amount: Money;
  revision: number;
  price_paid: Money;
}

/** استحقاق مباع: لقطة البيع موجودة، فالحدث يحمل فرع البيع ويومه. */
export interface LockedSoldEntitlement extends LockedRefundEntitlementBase {
  provenance: 'SOLD';
  sold_branch_id: string;
  sold_at: Date;
  sold_business_date: string;
  seller_employee_id: string;
}

/** استحقاق مستورد: مفيش بيع، فمفيش لقطة بيع ولا حدث. */
export interface LockedImportedEntitlement extends LockedRefundEntitlementBase {
  provenance: 'IMPORTED';
}

/** الاستحقاق المقفول؛ لقمته المالية وتاريخه هما أساس التحديث الذري. */
export type LockedRefundEntitlement = LockedSoldEntitlement | LockedImportedEntitlement;

/** لقطة جلسة تحت قفل المكوّن؛ هوية الجلسة موجودة لأن الحفظ بيتكلم بالجلسة نفسها. */
export interface LockedRefundSlot extends PackageSlot {
  readonly id: string;
}

/** صف الاسترداد؛ السبب والعضوية واللحظة بتثبت اللي عمل الاسترداد. */
export interface PackageRefundInsert {
  id: string;
  entitlement_id: string;
  component_id: string;
  sessions: number;
  amount: Money;
  method: 'CASH' | 'CARD';
  reason: string;
  refunded_by: string;
  refunded_by_membership_id: string;
  refunded_at: Date;
  entitlement_revision: number;
}

/** أثر الاسترداد بلا السبب؛ المبلغ والنسخة قبل وبعد. */
export interface PackageRefundAuditEntry {
  entity: 'package_entitlement';
  entityId: string;
  action: 'package.refunded';
  before: { refunded_amount: string; revision: number };
  after: { refunded_amount: string; revision: number; refund_id: string };
}

/** سلطة الاسترداد الحية على فرع الطلب. */
export interface PackageRefundAccessPort {
  /**
   * يثبت الشركة والعضويات قبل قراءة السلطة والاستحقاق.
   *
   * @returns يكتمل حيازة الأقفال حتى نهاية المعاملة
   */
  lock(): Promise<void>;
  /**
   * يعيد المنع والميزة والعضويات المؤهلة عند اللحظة المحقونة.
   *
   * @param at اللحظة الواحدة المستخدمة للطلب كله
   * @returns حقائق السلطة؛ أول عضوية مؤهلة هي منفّذة الاسترداد
   */
  read(at: Date): Promise<PackageRefundAccessFacts>;
}

/** مكان الفرع الذي يحدد اليوم التقويمي لصلاحية الباقة. */
export interface PackageRefundPlacePort {
  /**
   * يعيد توقيت الفرع الفعلي بعد إثبات ملكيته ونشاطه.
   *
   * @returns التوقيت أو null للفرع غير المتاح في النطاق
   */
  timezone(): Promise<string | null>;
}

/** مفتاح استرداد الباقات المستوردة؛ إعدادات النشاط هي اللي تملكه. */
export interface ImportedRefundsPort {
  /**
   * يقول هل النشاط سمح باسترداد الباقات المستوردة.
   *
   * @returns true بس لما يكون المفتاح مفعّل صراحة
   */
  importedRefundsEnabled(): Promise<boolean>;
}

/** تخزين الاستحقاق والمكوّن وجلساته وسطر الاسترداد داخل المعاملة نفسها. */
export interface PackageRefundRecords {
  /**
   * يقفل الاستحقاق ويعيد لقمته المالية وتاريخه ونسخته.
   *
   * @param entitlementId هوية الاستحقاق داخل شركة ونشاط الطلب
   * @returns الاستحقاق المقفول أو null للمجهول والخارج عن النطاق
   */
  lockEntitlement(entitlementId: string): Promise<LockedRefundEntitlement | null>;
  /**
   * يقفل المكوّن بس لو كان من الاستحقاق نفسه.
   *
   * @param entitlementId هوية الاستحقاق المقفول
   * @param componentId هوية المكوّن المطلوب
   * @returns هل المكوّن من الاستحقاق ده اتقفل
   */
  lockComponent(entitlementId: string, componentId: string): Promise<boolean>;
  /**
   * يقفل جلسات المكوّن كلها مرتبة بالمعرّف عشان كل الكاتبين يقفلوا بنفس الترتيب.
   *
   * @param entitlementId هوية الاستحقاق المقفول
   * @param componentId هوية المكوّن المقفول
   * @returns الجلسات المقفولة بقيمها المخزنة
   */
  lockSlots(entitlementId: string, componentId: string): Promise<readonly LockedRefundSlot[]>;
  /**
   * يدخل سطر الاسترداد بما فيه السبب والفاعل والعضوية واللحظة.
   *
   * @param refund صف الاسترداد الجديد
   * @returns يكتمل إدخال الصف داخل المعاملة
   */
  insertRefund(refund: PackageRefundInsert): Promise<void>;
  /**
   * يدخل سطر لكل جلسة مستردة من الجلسات المقفولة، بالترقيم وقيمة الجلسة المخزنة.
   *
   * @param refund سطر الاسترداد اللي بتترتبط بيه سطور الجلسات
   * @param ordinals أرقام الجلسات المستردة
   * @returns يكتمل إدخال سطور الجلسات داخل المعاملة
   */
  insertRefundSlots(refund: PackageRefundInsert, ordinals: readonly number[]): Promise<void>;
  /**
   * ينقل الجلسات المختارة من الحرة إلى المستردة، ويرفض لو واحدة ما اتنقلتش.
   *
   * @param ordinals أرقام الجلسات المستردة
   * @param sessions عدد الجلسات المطلوب استردادها
   * @returns لا شيء؛ الجلسات كلها اتنقلت
   */
  markSlotsRefunded(ordinals: readonly number[], sessions: number): Promise<void>;
  /**
   * يزيد المبلغ المسترد والنسخة على الاستحقاق المقفول.
   *
   * @param entitlementId هوية الاستحقاق المقفول
   * @param refundedAmount المبلغ المسترد بعد الاسترداد
   * @param revision النسخة بعد الاسترداد
   * @returns هل اتغير صف واحد؛ false تعني أن الاستحقاق مش موجود
   */
  updateEntitlement(
    entitlementId: string,
    refundedAmount: Money,
    revision: number,
  ): Promise<boolean>;
}

/** كل منافذ الاسترداد على معاملة شركة واحدة. */
export interface PackageRefundTransaction {
  access: PackageRefundAccessPort;
  place: PackageRefundPlacePort;
  settings: ImportedRefundsPort;
  packages: PackageRefundRecords;
  /**
   * يحفظ رد 201 مع الآثار أو يعيد الرد الأصلي لنفس البصمة.
   *
   * @param handler خطوات الاسترداد التي تعيد جسم الاستجابة
   * @returns الجسم المحفوظ وعلامة إعادة الإرسال
   */
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب أثر package.refunded بلا السبب داخل المعاملة.
   *
   * @param id هوية صف التدقيق
   * @param entry المبلغ والنسخة قبل وبعد وهوية سطر الاسترداد
   * @returns يكتمل إدخال الأثر
   */
  audit(id: string, entry: PackageRefundAuditEntry): Promise<void>;
  /**
   * يكتب حدث PackageSaleChanged في نفس معاملة الاسترداد.
   *
   * @param payload الحمولة المبنية من لقطة البيع
   * @returns يكتمل إدخال الحدث في الـ outbox
   */
  emit(payload: PackageSaleChangedPayload): Promise<void>;
}

/** حد معاملة الاسترداد؛ الساعة ومولد الهويات يبقيان عند حالة الاستخدام. */
export interface PackageRefundTransactions {
  /**
   * يشغل الاسترداد داخل معاملة الشركة الواحدة بهوية المستخدم.
   *
   * @param context الشركة والفاعل والنطاق ومفتاح إعادة الطلب وبصمته
   * @param work خطوات الاسترداد على منافذ المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(
    context: SessionWriteContext,
    work: (tx: PackageRefundTransaction) => Promise<T>,
  ): Promise<T>;
}
