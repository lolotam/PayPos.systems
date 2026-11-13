import { canonicalJson } from '@pospay/domain';
import type { RequestDiscountApprovalResponse } from '@pospay/contracts';
import type { components } from '@/shared/api/schema';
import type { SessionAttemptCommand } from './session-attempt';
import type { SessionDraftForm, SessionDraftLine, SessionPaidLineInput } from './session-drafts';
import type { SessionRecordingResult } from './session-recording-result';

type ApprovalResult = Pick<SessionRecordingResult, 'customer' | 'customerId' | 'rejected' | 'sessionId'>;
type CommandLines = SessionAttemptCommand['body']['lines'];
type RequestDiscountApprovalInput = components['schemas']['RequestDiscountApprovalInput'];

// سياق الطلب: من هي الزيارة والزبونة والعضوية اللي طلبت؛ زي ما أمر الجلسة بيبني نصه.
export type DiscountApprovalContext = {
  customer_id: string; session_id: string | null; occurred_at: string | null; requester_membership_id: string | null;
};

// ينزّل المعرّفات لأحرف صغيرة، ويرتّب المنفّذين ويزيل التكرار زي شروط الخادم؛ ترتيبهم في المُدخل ما يغيّرش البصمة.
function sortedPerformerIds(values: readonly string[]): string[] {
  const lowered = values.map((value) => value.toLowerCase());
  return [...new Set(lowered.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)))];
}

// البصمة على شروط الموافقة بتتبع شروط الخادم (D-2): الزبونة والزيارة والطالب والخدمة والسعر والخصم ومنفّذو السطر المرتّبين.
// الحصص برّه الشروط، فتعديلها ما يلغيش الموافقة.
export function discountApprovalFingerprint(line: SessionPaidLineInput, context: DiscountApprovalContext): string {
  return canonicalJson({
    customer_id: context.customer_id.toLowerCase(),
    session_id: context.session_id ? context.session_id.toLowerCase() : null,
    occurred_at: context.occurred_at,
    requester_membership_id: context.requester_membership_id ? context.requester_membership_id.toLowerCase() : null,
    service_id: line.service_id.toLowerCase(),
    price: line.price,
    discount: line.discount,
    performers: sortedPerformerIds(line.performers.map((performer) => performer.employee_id)),
  });
}

// السياق بيبني زي ما أمر الجلسة بيبني: زيارة محفوظة بجلسة ووقت=null، وزيارة جديدة بزبونة ووقت الزيارة.
// الموافقة مالهاش صاحب من غير زبونة، فالرجوع null بيقول إن مفيش بصمة تتعمل.
export function discountApprovalContext(result: ApprovalResult, drafts: SessionDraftForm): DiscountApprovalContext | null {
  const customerId = result.sessionId ? result.customerId : result.customer?.id ?? result.customerId;
  if (!customerId) return null;
  return { customer_id: customerId, session_id: result.sessionId,
    occurred_at: result.sessionId ? null : drafts.occurred_at ?? null,
    requester_membership_id: drafts.recorder_membership_id ?? null };
}

export function refusedDiscountDrafts(result: Pick<SessionRecordingResult, 'rejected'>, lines: SessionDraftLine[]): SessionDraftLine[] {
  return result.rejected.flatMap(({ localId }) => {
    const line = lines.find((draft) => draft.local_id === localId);
    return line && !line.from_package ? [line] : [];
  });
}

export function buildDiscountApprovalBody(result: ApprovalResult, drafts: SessionDraftForm, commands: CommandLines): RequestDiscountApprovalInput {
  const rows = refusedDiscountDrafts(result, drafts.lines);
  if (rows.length !== commands.length) throw new Error('DISCOUNT_APPROVAL_ROWS_INVALID');
  const customerId = result.sessionId ? result.customerId : result.customer?.id ?? result.customerId;
  if (!customerId) throw new Error('SESSION_CUSTOMER_REQUIRED');
  const lines = commands.map((line) => {
    if (!('price' in line)) throw new Error('DISCOUNT_APPROVAL_PACKAGE_INVALID');
    return { service_id: line.service_id, price: line.price, discount: line.discount,
      performers: line.performers.map((performer) => ({ employee_id: performer.employee_id,
        ...(performer.share_bps === undefined ? {} : { share_bps: performer.share_bps }) })) };
  });
  return {
    customer_id: customerId,
    ...(result.sessionId ? { session_id: result.sessionId } : drafts.occurred_at ? { occurred_at: drafts.occurred_at } : {}),
    lines,
    ...(drafts.recorder_membership_id ? { requester_membership_id: drafts.recorder_membership_id } : {}),
  };
}

export function discountProposalLocalIds(proposals: RequestDiscountApprovalResponse['proposals'], rows: SessionDraftLine[]): Record<number, string> {
  return Object.fromEntries(proposals.map((proposal) => {
    const row = rows[proposal.input_index];
    if (!row) throw new Error('DISCOUNT_APPROVAL_ROW_MAP_INVALID');
    return [proposal.input_index, row.local_id];
  }));
}
