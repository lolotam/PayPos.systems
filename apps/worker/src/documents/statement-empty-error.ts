/**
 * رندر البيان لقى مفيش تغطية في الفترة: الفشل نهائي من أول مرة وبيتقفل من غير PDF (FR-013a).
 * الرسالة رمز ثابت، فمفيش اسم موظفة ولا رقم ولا أي محتوى بيان بيوصل Redis.
 */
export class AttendanceStatementEmptyError extends Error {
  /** رمز العجز الثابت؛ هو نفسه كود الحالة في العقد. */
  readonly code = 'STATEMENT_EMPTY' as const;

  constructor() {
    super('STATEMENT_EMPTY');
    this.name = 'AttendanceStatementEmptyError';
  }
}
