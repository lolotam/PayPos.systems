import { id } from '@pospay/contracts';

import type { ClearAbandonedDestination } from '../use-cases/clear-abandoned-destination/clear-abandoned-destination.ts';

export function destinationCleanupProcessor(cleanup: ClearAbandonedDestination) {
  return async (input: {
    company_id: string;
    attempt_id: string;
    execution_id: string;
    operator_id: string;
    execution_stopped: boolean;
  }): Promise<boolean> => {
    const parsed = [input.company_id, input.attempt_id, input.execution_id, input.operator_id].map(
      (value) => id.safeParse(value),
    );
    if (parsed.some((value) => !value.success) || input.execution_stopped !== true)
      throw new Error('NOTIFICATION_CLEANUP_INVALID');
    try {
      return await cleanup.execute({
        companyId: input.company_id,
        attemptId: input.attempt_id,
        executionId: input.execution_id,
        operatorId: input.operator_id,
        executionStopped: true,
      });
    } catch {
      throw new Error('NOTIFICATION_CLEANUP_FAILED');
    }
  };
}
