import type { CommissionCorrectionAttribution } from './commission-correction-step.ts';

/**
 * مدى ارتباط الموظفة بالفرع في اللقطة المجمّدة: من أول يوم inclusي لآخر يوم inclusي.
 * آخر يوم فاضي يعني إن المدى مفتوح للمستقبل، فأي تاريخ بعده يكون داخل المدى.
 */
export interface CommissionAttachmentInterval {
  readonly branchId: string;
  readonly attachedFrom: string;
  readonly attachedTo: string | null;
}

/** مُدخلات حل نسبة المصدر: فرع المصدر وتاريخ نشاطه الإجباريان ولقطة ارتباطاته المجمّدة. */
export interface CommissionSourceAttributionInput {
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachments: readonly CommissionAttachmentInterval[];
}

/**
 * يحل نسبة المصدر من الفرع وتاريخ النشاط الإجباريين ولقطة الارتباط المجمّدة (FR-040).
 * الفروع المرفقة هي اللي مداها غطّى تاريخ النشاط، وهتترتب وتتفرد عشان النسبة
 * ما تتبدلش بنفس المرجع. والموظفة اللي مفيش مدى غطّا تاريخها بتفضل بفروع فاضية،
 * واللقطة المجمّدة هي المصدر الوحيد، فربط اتعدل بعد الاعتماد ما ينقلش النسبة.
 *
 * @param input فرع المصدر وتاريخ نشاطه الإجباريان ولقطة الارتباطات المجمّدة
 * @returns نسبة المصدر كاملة: الفرع والتاريخ والفروع التي كانت مربوطة في ذلك اليوم
 */
export function resolveSourceAttribution(
  input: CommissionSourceAttributionInput,
): CommissionCorrectionAttribution {
  const branchIds = new Set<string>();
  for (const attachment of input.attachments) {
    if (attachment.attachedFrom > input.sourceBusinessDate) continue;
    const { attachedTo } = attachment;
    if (attachedTo !== null && attachedTo < input.sourceBusinessDate) continue;
    branchIds.add(attachment.branchId);
  }
  return {
    sourceBranchId: input.sourceBranchId,
    sourceBusinessDate: input.sourceBusinessDate,
    attachedBranchIds: [...branchIds].sort(),
  };
}
