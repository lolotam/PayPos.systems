/** مدخل أثر تغيير المنفّذين؛ السبب والأسماء لا يدخلان، والنسب أعداد صحيحة لا مال. */
export interface LinePerformersAuditInput {
  sessionId: string;
  lineId: string;
  changeId: string;
  revisionBefore: number;
  changerUserId: string;
  changerMembershipId: string;
  changedAt: Date;
  performersBefore: readonly { employee_id: string; share_bps: number }[];
  performersAfter: readonly { employee_id: string; share_bps: number }[];
}

/**
 * يبني أثر تغيير المنفّذين بلا سبب وبلا أسماء وبلا هاتف أو بيانات عميلة.
 * النسخة اللاحقة هي السابقة زائد واحد، والمجموعتان تُعلان بالترتيب الذي أعلنه الكاتب.
 *
 * @param input هوية التغيير والنسختين ومجموعتَي المنفّذات قبل وبعد
 * @returns أثر service_line جاهز للإدخال
 */
export function linePerformersAudit(input: LinePerformersAuditInput) {
  return {
    entity: 'service_line' as const,
    entityId: input.lineId,
    action: 'service_line.performers_changed' as const,
    after: {
      session_id: input.sessionId,
      line_id: input.lineId,
      change_id: input.changeId,
      revision_before: input.revisionBefore,
      revision_after: input.revisionBefore + 1,
      changer_user_id: input.changerUserId,
      changer_membership_id: input.changerMembershipId,
      changed_at: input.changedAt.toISOString(),
      performers_before: input.performersBefore.map((row) => ({
        employee_id: row.employee_id,
        share_bps: row.share_bps,
      })),
      performers_after: input.performersAfter.map((row) => ({
        employee_id: row.employee_id,
        share_bps: row.share_bps,
      })),
    },
  };
}
