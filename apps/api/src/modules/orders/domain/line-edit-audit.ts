import { moneyToString } from '@pospay/domain';
import type { SessionLimit } from './session-types.ts';

/** مدخل أثر التعديل؛ السبب والأسماء لا يدخلان. */
export interface LineEditAuditInput {
  sessionId: string;
  lineId: string;
  editId: string;
  revisionBefore: number;
  editorUserId: string;
  editorMembershipId: string;
  changedAt: Date;
  previous: { price: bigint; discount: bigint; net: bigint };
  next: {
    price: bigint;
    discount: bigint;
    net: bigint;
    effective_discount_bps: number;
    limit_bps_applied: number | null;
    limit_source: SessionLimit['source'];
  };
}

/**
 * يبني أثر تعديل السعر والخصم بلا سبب وبلا أسماء وبلا هاتف أو بيانات عميلة.
 * النسخة اللاحقة هي السابقة زائد واحد، والمال يخرج بنص من ثلاث خانات.
 *
 * @param input هويات التعديل والقيم السابقة واللاحقة
 * @returns أثر service_line جاهز للإدخال
 */
export function lineEditAudit(input: LineEditAuditInput) {
  return {
    entity: 'service_line' as const,
    entityId: input.lineId,
    action: 'service_line.price_discount_edited' as const,
    after: {
      session_id: input.sessionId,
      line_id: input.lineId,
      edit_id: input.editId,
      revision_before: input.revisionBefore,
      revision_after: input.revisionBefore + 1,
      editor_user_id: input.editorUserId,
      editor_membership_id: input.editorMembershipId,
      changed_at: input.changedAt.toISOString(),
      previous_price: moneyToString(input.previous.price),
      previous_discount: moneyToString(input.previous.discount),
      previous_net: moneyToString(input.previous.net),
      new_price: moneyToString(input.next.price),
      new_discount: moneyToString(input.next.discount),
      new_net: moneyToString(input.next.net),
      effective_discount_bps: input.next.effective_discount_bps,
      limit_bps_applied: input.next.limit_bps_applied,
      limit_source: input.next.limit_source,
    },
  };
}
