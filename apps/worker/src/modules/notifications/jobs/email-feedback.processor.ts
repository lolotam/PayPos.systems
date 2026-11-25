import { EMAIL_FEEDBACK_INBOX_ID, EMAIL_FEEDBACK_JOB } from '@pospay/notifications';
import type { Job } from 'bullmq';
import type { ReconcileEmailFeedback } from '../use-cases/reconcile-email-feedback/reconcile-email-feedback.ts';

export function emailFeedbackProcessor(reconcile: ReconcileEmailFeedback) {
  return async (job: Pick<Job, 'data'> & { name?: string }): Promise<void> => {
    const data: unknown = job.data;
    if (
      (job.name !== undefined && job.name !== EMAIL_FEEDBACK_JOB) ||
      typeof data !== 'object' ||
      data === null ||
      Object.keys(data).length !== 1 ||
      !('inbox_id' in data) ||
      typeof data.inbox_id !== 'string' ||
      !EMAIL_FEEDBACK_INBOX_ID.test(data.inbox_id)
    )
      throw new Error('EMAIL_FEEDBACK_JOB_INVALID');
    await reconcile.execute(data.inbox_id);
  };
}
