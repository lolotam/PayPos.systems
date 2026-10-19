import { moneyToString } from '@pospay/domain';

/** مدخل أثر الإلغاء؛ السبب والأسماء لا يدخلان، والأرقام نسخة واحدة لأن الإلغاء لا يغيّرها. */
export interface LineCancelAuditInput {
  sessionId: string;
  lineId: string;
  cancellationId: string;
  revisionBefore: number;
  cancellerUserId: string;
  cancellerMembershipId: string;
  cancelledAt: Date;
  figures: { price: bigint; discount: bigint; net: bigint };
}

/**
 * يبني أثر إلغاء السطر بلا سبب وبلا أسماء وبلا هاتف أو بيانات عميلة.
 * النسخة اللاحقة هي السابقة زائد واحد، والمال يخرج بنص من ثلاث خانات.
 *
 * @param input هويات الإلغاء وأرقام السطر كما بقيت
 * @returns أثر service_line جاهز للإدخال
 */
export function lineCancelAudit(input: LineCancelAuditInput) {
  return {
    entity: 'service_line' as const,
    entityId: input.lineId,
    action: 'service_line.cancelled' as const,
    after: {
      session_id: input.sessionId,
      line_id: input.lineId,
      cancellation_id: input.cancellationId,
      revision_before: input.revisionBefore,
      revision_after: input.revisionBefore + 1,
      canceller_user_id: input.cancellerUserId,
      canceller_membership_id: input.cancellerMembershipId,
      cancelled_at: input.cancelledAt.toISOString(),
      price: moneyToString(input.figures.price),
      discount: moneyToString(input.figures.discount),
      net: moneyToString(input.figures.net),
    },
  };
}
