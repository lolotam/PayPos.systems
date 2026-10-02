export interface OtpDeviceContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly deviceId: string;
}

export interface OtpChallengeRecord {
  readonly id: string;
  readonly recipientHash: Buffer;
  readonly hashKeyId: string;
  readonly userId: string | null;
  readonly deviceContext: OtpDeviceContext;
  readonly codeMac: Buffer | null;
  readonly derivationKeyId: string | null;
  readonly verificationKeyId: string | null;
  readonly status: string;
  readonly failedAttempts: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface OtpAttemptRecord {
  readonly id: string;
  readonly challengeId: string;
  readonly recipientHash: Buffer;
  readonly hashKeyId: string;
  readonly userId: string | null;
  readonly locale: 'ar' | 'en';
  readonly providerTemplateName: string | null;
  readonly status: string;
  readonly executionId: string | null;
  readonly sendDeadline: Date;
  readonly preparationDeadline: Date;
}

export interface OtpPreparation {
  readonly eligible?: boolean;
  readonly challenge: OtpChallengeRecord;
  readonly attemptId: string;
  readonly locale: 'ar' | 'en';
  readonly providerTemplateName: string;
  readonly preparationDeadline: Date;
  /** لا يحسب الاعتماد قبل فوز فحص STOP داخل القفل. */
  materializeMac(): Buffer;
}

export interface OtpExecutionResult {
  readonly status: 'SENT' | 'FAILED' | 'EXPIRED' | 'SUPPRESSED';
  readonly failureCode:
    | 'PROVIDER_ACCEPTED'
    | 'PROVIDER_REJECTED'
    | 'PROVIDER_UNKNOWN'
    | 'ADMISSION_REFUSED'
    | 'DESTINATION_INVALID'
    | 'CHALLENGE_INVALID'
    | 'CONFIG_INVALID'
    | 'PREPARATION_WINDOW_ENDED';
  readonly outcomeKnown: boolean;
  readonly providerMessageDigest?: Uint8Array;
}
