export interface EmailRequest {
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly safeParameters: readonly unknown[];
  /** وسم الشركة — بريد الشركات بس. */
  readonly companyId?: string | undefined;
  readonly attemptId: string;
  readonly executionId: string;
  readonly deadline: Date | null;
  /**
   * ارتباط الاعتماد: `{ auth_challenge_id, attempt_id, execution_id }` بدل وسم الشركة.
   * وقت الحاضر غايب — بريد الشركة بيمشي بوسوم الشركة.
   */
  readonly authChallengeId?: string | undefined;
}
