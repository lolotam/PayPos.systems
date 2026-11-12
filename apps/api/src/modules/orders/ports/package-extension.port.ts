import type { SessionWriteContext } from './service-session-transactions.port.ts';

/** سلطة التمديد بعد الأقفال؛ can_read محفوظ للمستهلك ولا يدخل في قرار الكتابة. */
export interface PackageExtensionAccessFacts {
  denied: boolean;
  feature: boolean;
  can_read: boolean;
  eligible: readonly string[];
}

/** الاستحقاق المقفول؛ تاريخه هو رمز المقارنة والتحديث الذري. */
export type LockedPackageEntitlement = {
  expires_on: string;
};

/** صف التاريخ الوحيد الذي يحمل السبب؛ بقية الحقول تثبت الفاعل واللحظة والنطاق. */
export interface PackageExtensionInsert {
  id: string;
  entitlement_id: string;
  previous_expires_on: string;
  new_expires_on: string;
  reason: string;
  extended_by: string;
  extended_by_membership_id: string;
  extended_at: Date;
}

/** أثر التمديد بلا السبب ولا أي أثر مالي أو حدث. */
export interface PackageExtensionAuditEntry {
  entity: 'package_entitlement';
  entityId: string;
  action: 'package.extended';
  before: { expires_on: string };
  after: { expires_on: string; extension_id: string };
}

/** سلطة التمديد الحية على فرع الطلب. */
export interface PackageExtensionAccessPort {
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
   * @returns حقائق السلطة؛ أول عضوية مؤهلة هي منفّذة التمديد
   */
  read(at: Date): Promise<PackageExtensionAccessFacts>;
}

/** مكان الفرع الذي يحدد اليوم التقويمي لحد السنتين. */
export interface PackageExtensionPlacePort {
  /**
   * يعيد توقيت الفرع الفعلي بعد إثبات ملكيته ونشاطه.
   *
   * @returns التوقيت أو null للفرع غير المتاح في النطاق
   */
  timezone(): Promise<string | null>;
}

/** تخزين الاستحقاق وتاريخ تمديده داخل المعاملة نفسها. */
export interface PackageExtensionRecords {
  /**
   * يقفل الاستحقاق ويعيد تاريخ انتهائه الحالي.
   *
   * @param entitlementId هوية الاستحقاق داخل شركة ونشاط الطلب
   * @returns التاريخ المقفول أو null للمجهول والخارج عن النطاق
   */
  lock(entitlementId: string): Promise<LockedPackageEntitlement | null>;
  /**
   * يدخل صف التمديد بما فيه السبب والفاعل والعضوية واللحظة.
   *
   * @param extension صف التاريخ الجديد
   * @returns يكتمل إدخال الصف داخل المعاملة
   */
  insert(extension: PackageExtensionInsert): Promise<void>;
  /**
   * يحدث تاريخ الانتهاء فقط إذا بقي مساوياً للتاريخ المتوقع.
   *
   * @param entitlementId هوية الاستحقاق المقفول
   * @param expectedExpiresOn التاريخ الذي رآه العميل
   * @param newExpiresOn التاريخ الجديد الأحدث
   * @returns هل تغيّر صف واحد؛ false تعني تعارضاً مع كاتب آخر
   */
  updateExpiry(
    entitlementId: string,
    expectedExpiresOn: string,
    newExpiresOn: string,
  ): Promise<boolean>;
}

/** كل منافذ التمديد على معاملة شركة واحدة. */
export interface PackageExtensionTransaction {
  access: PackageExtensionAccessPort;
  place: PackageExtensionPlacePort;
  packages: PackageExtensionRecords;
  /**
   * يحفظ رد 201 مع الآثار أو يعيد الرد الأصلي لنفس البصمة.
   *
   * @param handler خطوات التمديد التي تعيد جسم الاستجابة
   * @returns الجسم المحفوظ وعلامة إعادة الإرسال
   */
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب أثر package.extended بلا السبب داخل المعاملة.
   *
   * @param id هوية صف التدقيق
   * @param entry التاريخ قبل وبعد وهوية صف التمديد
   * @returns يكتمل إدخال الأثر
   */
  audit(id: string, entry: PackageExtensionAuditEntry): Promise<void>;
}

/** حد معاملة التمديد؛ الساعة ومولد الهويات يبقيان عند حالة الاستخدام. */
export interface PackageExtensionTransactions {
  /**
   * يشغل التمديد داخل معاملة الشركة الواحدة بهوية المستخدم.
   *
   * @param context الشركة والفاعل والنطاق ومفتاح إعادة الطلب وبصمته
   * @param work خطوات التمديد على منافذ المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(
    context: SessionWriteContext,
    work: (tx: PackageExtensionTransaction) => Promise<T>,
  ): Promise<T>;
}
