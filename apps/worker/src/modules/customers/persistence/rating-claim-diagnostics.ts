import { errorDiagnostic, type Logger } from '@pospay/observability';
import type { RatingClaimDiagnostics } from '../ports/rating-claim-diagnostics.port.ts';

/** يبني تشخيص فشل الطلب على حدود السجل الآمن، مع استمرار باقي الصفحة وإعادة الجولة لاحقاً. */
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
  };
}
