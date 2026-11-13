import type { RequestDiscountApprovalResponse } from '@pospay/contracts';
import type { components } from '@/shared/api/schema';
import type { SessionAttemptCommand } from './session-attempt';
import type { SessionDraftForm, SessionDraftLine } from './session-drafts';
import type { SessionRecordingResult } from './session-recording-result';

type ApprovalResult = Pick<SessionRecordingResult, 'customer' | 'customerId' | 'rejected' | 'sessionId'>;
type CommandLines = SessionAttemptCommand['body']['lines'];
type RequestDiscountApprovalInput = components['schemas']['RequestDiscountApprovalInput'];

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
