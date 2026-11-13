import type { RequesterDiscountProposalList } from '@pospay/contracts';
import type { SessionRecordingResult } from './session-recording-result';

export type TrackedDiscountRequest = { requestId: string; localIds: Record<number, string> };
type Item = RequesterDiscountProposalList['items'][number];
type LineView = { proposal: Item | null; covered: boolean };

function latestRequest(requests: TrackedDiscountRequest[], localId: string): TrackedDiscountRequest | null {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (request && Object.values(request.localIds).includes(localId)) return request;
  }
  return null;
}

// القرارات من إشارات الخادم فقط: الحالة وapproval_refusal مع discount_proposal_id؛ بلا ساعة أو بصمة لأن الانتهاء والشروط للخادم (D-4، D-7).
export function discountApprovalView(
  rejected: SessionRecordingResult['rejected'], requests: TrackedDiscountRequest[], itemsByRequest: Record<string, Item[] | undefined>,
): { queried: string[]; lines: Record<string, LineView>; requestable: string[];
  attach: Array<{ localId: string; proposalId: string }> } {
  const rejectedIds = new Set(rejected.map((row) => row.localId));
  const queried = requests.filter((request) => Object.values(request.localIds).some((localId) => rejectedIds.has(localId)))
    .map((request) => request.requestId);
  const lines: Record<string, LineView> = {}, requestable: string[] = [];
  const attach: Array<{ localId: string; proposalId: string }> = [];
  for (const row of rejected) {
    const latest = latestRequest(requests, row.localId);
    const items = latest ? itemsByRequest[latest.requestId] : undefined;
    const proposal = latest && items
      ? items.find((item) => latest.localIds[item.input_index] === row.localId) ?? null : null;
    let covered = latest !== null && items === undefined;
    if (proposal?.status === 'PENDING') covered = true;
    if (proposal?.status === 'APPROVED') {
      const refusedThis = row.error.approval_refusal !== undefined && row.error.discount_proposal_id === proposal.id;
      covered = !refusedThis;
      if (!refusedThis) attach.push({ localId: row.localId, proposalId: proposal.id });
    }
    lines[row.localId] = { proposal, covered };
    if (!covered) requestable.push(row.localId);
  }
  return { queried, lines, requestable, attach };
}
