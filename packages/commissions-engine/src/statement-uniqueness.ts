import type { IncomingCommissionCarry } from './period-input-types.ts';
import { carryRef, correctionRef, lineRef, saleRef, tipRef } from './statement-refs.ts';
import type {
  StatementAttachmentRow,
  StatementCorrectionSource,
  StatementLineSource,
  StatementSaleSource,
  StatementTipSource,
} from './statement-types.ts';

/** مصادر موظفة واحدة بعد الاختيار المشترك وقبل التسعير. */
export interface StatementSources {
  readonly lines: readonly StatementLineSource[];
  readonly sales: readonly StatementSaleSource[];
  readonly tips: readonly StatementTipSource[];
  readonly corrections: readonly StatementCorrectionSource[];
  readonly carries: readonly IncomingCommissionCarry[];
}

/**
 * مفتاح صف أو مرفق بيتكرر في مدخل البناء. القاعدة بترفض التكرار عند التجميد (مفتاح الصف
 * (employee_id, source_ref) ومفتاح المرفق (employee_id, branch_id, attached_from))، فالباني
 * بيرفضه قبل التسعير بدل ما يطلع كشف مش هيتجمّد، وبيسمّي المفتاح المتكرر.
 */
export class StatementDuplicateKeyError extends RangeError {
  /**
   * يحفظ نوع المفتاح ونصه عشان المستدعي يعرف أنهي صف اتكرر.
   *
   * @param kind صف أو مرفق
   * @param key المفتاح المتكرر نصًا
   */
  constructor(
    readonly kind: 'row' | 'attachment',
    readonly key: string,
  ) {
    super(`Statement input repeats ${kind === 'row' ? 'a row' : 'an attachment'} key: ${key}`);
    this.name = 'StatementDuplicateKeyError';
  }
}

/**
 * أول مفتاح اتكرر في القائمة، أو null لو كلها مختلفة.
 *
 * @param keys المفاتيح
 * @returns المفتاح المتكرر أو null
 */
function firstRepeated(keys: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/**
 * يتأكد إن مصادر موظفة واحدة (بنود وبيوع وبقشيش وتصحيحات ومرحّلات) مفيهاش مرجع مصدر متكرر.
 *
 * @param employeeId الموظفة
 * @param assembled مصادرها بعد الاختيار المشترك وقبل التسعير
 */
export function assertUniqueSources(employeeId: string, assembled: StatementSources): void {
  const repeated = firstRepeated([
    ...assembled.lines.map(lineRef),
    ...assembled.sales.map(saleRef),
    ...assembled.tips.map(tipRef),
    ...assembled.corrections.map(correctionRef),
    ...assembled.carries.map(carryRef),
  ]);
  if (repeated !== null) throw new StatementDuplicateKeyError('row', `${employeeId}/${repeated}`);
}

/**
 * يتأكد إن المرفقات المقصوصة مفيهاش مفتاح (الموظفة، الفرع، بداية الارتباط) متكرر.
 *
 * @param attachments المرفقات المقصوصة اللي هتتجمّد
 */
export function assertUniqueAttachments(attachments: readonly StatementAttachmentRow[]): void {
  const repeated = firstRepeated(
    attachments.map((row) => `${row.employeeId}/${row.branchId}/${row.attachedFrom}`),
  );
  if (repeated !== null) throw new StatementDuplicateKeyError('attachment', repeated);
}
