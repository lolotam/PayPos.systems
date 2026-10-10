import type { DeviceLockFacts } from '../domain/passkey-device-lock.ts';

/** سياق التسجيل الموثق، لا يقبل employee_id من الهاتف. */
export interface PasskeyScope {
  readonly userId: string;
  readonly sessionId: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
}
/** استجابة المتصفح تحمل إثبات التسجيل فقط وتظل داخل واجهة الاعتماد. */
export interface RegistrationEvidence {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: 'platform' | 'cross-platform' | undefined;
  clientExtensionResults: { credProps?: { rk?: boolean | undefined } | undefined };
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?:
      ('ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb')[] | undefined;
    authenticatorData?: string | undefined;
    publicKey?: string | undefined;
    publicKeyAlgorithm?: number | undefined;
  };
}
/** خادم الاعتماد وحده يثبت UV ويكتب المادة العالمية؛ هذا المنفذ لا يعطي عميل SQL. */
export interface PasskeyRegistration {
  /** يتحقق من التسجيل مرة واحدة ويرجع معرفاً داخلياً فقط.
   *
   * @param scope سياق الموظف الموثق
   * @param challengeId معرف التحدي الصادر
   * @param response استجابة المتصفح
   */
  enroll(
    scope: PasskeyScope,
    challengeId: string,
    response: RegistrationEvidence,
  ): Promise<string | null>;
}
/** معاملة الموظف تثبت الأهلية وتاريخ الربط والتدقيق والحدث معاً. */
export interface PasskeyTransactions {
  /** يفحص الهاتف قبل بدء التسجيل دون كتابة ربط.
   *
   * @param scope سياق الموظف الموثق
   * @param installationId معرف التثبيت المؤقت
   */
  deviceLock(scope: PasskeyScope, installationId: string): Promise<Omit<DeviceLockFacts, 'step'>>;
  /** يثبت الأهلية والربط والتدقيق والحدث في commit واحد.
   *
   * @param scope سياق الموظف الموثق
   * @param work عمل الربط داخل المعاملة
   */
  run<T>(
    scope: PasskeyScope,
    work: (binding: {
      /** يقرأ روابط الشخص والهاتف بعد قفل الموظف ثم التثبيت.
       *
       * @param installationId معرف التثبيت المؤقت
       */
      deviceLock(installationId: string): Promise<Omit<DeviceLockFacts, 'step'>>;
      /** يسترجع التاريخ لمنع استبدال الربط النشط. */
      history(): Promise<{ active: boolean; revision: number }>;
      /** يثبت الربط والهاتف مع التدقيق والحدث.
       *
       * @param record الربط الجديد
       * @param record.id معرف الربط
       * @param record.passkeyId معرف الاعتماد العالمي
       * @param record.revision نسخة الربط
       * @param record.at وقت التسجيل
       * @param record.installationId معرف التثبيت المؤقت أو غيابه للتوافق
       */
      insert(record: {
        id: string;
        passkeyId: string;
        revision: number;
        at: Date;
        installationId: string | null;
      }): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}
