export interface EmailRequest {
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly safeParameters: readonly unknown[];
  readonly companyId: string;
  readonly attemptId: string;
  readonly executionId: string;
  readonly deadline: Date | null;
}
