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
  /** يثبت الأهلية والربط والتدقيق والحدث في commit واحد.
   *
   * @param scope سياق الموظف الموثق
   * @param work عمل الربط داخل المعاملة
   */
  run<T>(
    scope: PasskeyScope,
    work: (binding: {
      history(): Promise<{ active: boolean; revision: number }>;
      insert(record: { id: string; passkeyId: string; revision: number; at: Date }): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}
