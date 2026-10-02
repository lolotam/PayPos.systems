export interface StaffDeviceContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly deviceId: string;
}

export interface OtpIdentity {
  readonly hash: Uint8Array;
  readonly hashKeyId: string;
}

export interface OtpChallenge {
  readonly id: string;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly userId: string | null;
  readonly deviceContext: StaffDeviceContext;
  readonly codeMac: Uint8Array | null;
  readonly derivationKeyId: string | null;
  readonly verificationKeyId: string | null;
  readonly status: string;
  readonly failedAttempts: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface OtpAttempt {
  readonly id: string;
  readonly challengeId: string;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly userId: string | null;
  readonly locale: 'ar' | 'en';
  readonly providerTemplateName: string | null;
  readonly status: string;
  readonly executionId: string | null;
  readonly sendDeadline: Date;
  readonly preparationDeadline: Date;
}

export interface StaffSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly context: StaffDeviceContext;
  readonly authenticatedAt: Date;
  readonly deadline: Date;
}

/** النقل يستقبل هوية السجل فقط حتى لا يغادر الاعتماد ذاكرة المرسل. */
export interface OtpSender {
  /** لا تعطي نتيجة غير مؤكدة تصريحاً بالإرسال أو إعادة المحاولة. */
  enqueue(ids: { challengeId: string; attemptId: string }, deadline: Date): Promise<void>;
}

export interface OtpStrategies {
  /** نفس الهوية العامة التي يستخدمها STOP وإرسال الشركات. */
  identify(phone: string): OtpIdentity & { valid: boolean };
  /** ترتيب القفل مستقل عن الشركة لمنع سباق STOP. */
  phoneLockKey(hash: Uint8Array): bigint;
}

export interface StaffEligibility {
  /** لا يفتح الشركة إلا بعد إثبات الجهاز، ولا يستعمل العضوية لتخمين سياق آخر. */
  eligible(userId: string, device: StaffDeviceContext, deadline?: Date): Promise<boolean>;
  /** يثبت الجهاز ثانية قبل الإصدار وعلى كل طلب. */
  deviceValid(device: StaffDeviceContext, deadline?: Date): Promise<boolean>;
}

export interface OtpCapability {
  /** مستقل عن استعداد الخدمة العادي، ويتكرر قبل التأثير الخارجي. */
  ready(deadline?: Date): Promise<boolean>;
}

export interface OtpRates {
  /** القرار الذري يستخدم ساعة Redis ولا يخزن الهاتف أو عنوان الشبكة. */
  request(hash: Uint8Array, ip: string, challengeId: string): Promise<number>;
  /** كل معرف صادر يرتبط بالبصمة قبل فحص الأهلية، بما فيه الطلب غير المؤهل. */
  verify(challengeId: string, ip: string): Promise<number>;
}
