import { errorDiagnostic, type Logger } from '@pospay/observability';
import type { RatingClaimDiagnostics } from '../ports/rating-claim-diagnostics.port.ts';

/** يبني تشخيص مجدول طلبات التقييم على حدود السجل الآمن، مع استمرار باقي الطلبات وإعادة الجولة لاحقاً. */
export function ratingClaimDiagnostics(logger: Logger): RatingClaimDiagnostics {
  return {
    failed: (companyId, error) =>
      logger.error(
        {
          company_id: companyId,
          code: 'RATING_CLAIM_REQUEST_RETRY',
          failure: errorDiagnostic(error),
          cause: errorDiagnostic(error instanceof Error ? error.cause : undefined),
        },
        'error',
      ),
    overflow: (companyId, report) =>
      logger.warn(
        {
          company_id: companyId,
          code: 'RATING_CLAIMS_OVERFLOW',
          overflow_count: report.overflowCount,
          oldest_retry_age_ms:
            report.oldestRetryEligibleAt === null
              ? null
              : Math.max(0, report.now - report.oldestRetryEligibleAt),
          last_completed_sweep_id: report.lastCompletedSweepId,
          reconcile_required: report.reconcileRequired,
        },
        'rating claims overflow',
      ),
    fenceLost: (companyId, code) =>
      logger.warn(
        { company_id: companyId, code: 'RATING_CLAIMS_FENCE_LOST', state_code: code },
        'rating claims fence lost',
      ),
    turnSummary: (companyId, summary) =>
      logger.info(
        {
          company_id: companyId,
          code: 'RATING_CLAIMS_TURN',
          end: summary.end,
          forward_visits: summary.forwardVisits,
          retry_visits: summary.retryVisits,
          settlements: summary.settlements,
        },
        'rating claims turn',
      ),
  };
}
