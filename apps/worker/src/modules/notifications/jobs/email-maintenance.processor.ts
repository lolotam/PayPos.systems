import type { Job } from 'bullmq';
import type { ClearEmailFeedbackPayloads } from '../use-cases/clear-email-feedback-payloads/clear-email-feedback-payloads.ts';
import type { RecoverEmailFeedback } from '../use-cases/recover-email-feedback/recover-email-feedback.ts';

export function emailMaintenanceProcessor(
  recover: RecoverEmailFeedback,
  clear: ClearEmailFeedbackPayloads,
) {
  return async (job: Pick<Job, 'name'>): Promise<void> => {
    if (job.name === 'recover-email-feedback') await recover.execute();
    else if (job.name === 'clear-email-payloads') await clear.execute();
    else throw new Error('EMAIL_MAINTENANCE_JOB_INVALID');
  };
}
