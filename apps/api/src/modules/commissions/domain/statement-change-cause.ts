/** بصمتا الكشف كما شافهم المراجع، أو كما بيطلعوا دلوقتي: بصمة المدخلات وبصمة الكشف (D-6). */
export interface StatementFingerprints {
  readonly input: string;
  readonly statement: string;
}

/** سبب تغيّر الكشف من وقت المراجعة: المدخلات، أو الصفوف المجمّدة بس (D-26). */
export type StatementChangeCause = 'INPUTS' | 'STATEMENT';

/**
 * يحدد هل الكشف المراجَع اتغيّر من وقت المراجعة وإيه السبب (FR-025، CM-28c، CM-32b). لو
 * البصمتين اتغيروا مع بعض السبب `INPUTS` (D-26)؛ لو بصمة الكشف لوحدها السبب `STATEMENT`
 * (اسم أو ارتباط فرع ما فيهوش حدث كاتب)؛ ولو ولا واحدة اتغيرت يرجّع null.
 *
 * @param reviewed البصمتان اللي المراجع شافهم
 * @param current البصمتان اللي بيطلعوا دلوقتي من الباني
 * @returns سبب التغيّر أو null لما الكشف زي ما اتراجع
 */
export function statementChangeCause(
  reviewed: StatementFingerprints,
  current: StatementFingerprints,
): StatementChangeCause | null {
  if (reviewed.input !== current.input) return 'INPUTS';
  if (reviewed.statement !== current.statement) return 'STATEMENT';
  return null;
}
