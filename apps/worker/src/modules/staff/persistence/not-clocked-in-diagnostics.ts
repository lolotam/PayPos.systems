import { errorDiagnostic, type Logger } from '@pospay/observability';
import type { NotClockedInDiagnostics } from '../ports/not-clocked-in.port.ts';

export function notClockedInDiagnostics(
  logger: Logger,
  code = 'ATTENDANCE_NOT_CLOCKED_IN_RETRY',
): NotClockedInDiagnostics {
  return {
    failed: (companyId, error) => logger.error({
      company_id: companyId,
      code,
      failure: errorDiagnostic(error),
      cause: errorDiagnostic(error instanceof Error ? error.cause : undefined),
    }, 'error'),
  };
}
