// The queue the email feedback intake hands its id-only jobs to; the worker reconciles them (spec 075
// FR-005). The payload carries the inbox id and nothing else.
export const EMAIL_FEEDBACK_QUEUE = 'notifications-email-feedback';
export const EMAIL_FEEDBACK_JOB = 'process-email-feedback';
export const EMAIL_FEEDBACK_INBOX_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The id-only job of one inbox row.
 *
 * @param id the inbox uuid
 * @returns the queue job
 */
export function emailFeedbackJob(id: string) {
  if (!EMAIL_FEEDBACK_INBOX_ID.test(id)) throw new Error('EMAIL_FEEDBACK_JOB_INVALID');
  return {
    name: EMAIL_FEEDBACK_JOB,
    data: { inbox_id: id },
    options: { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
  };
}

/** The queue could not take the job; the stored row stays unconfirmed and the worker's sweep retries it. */
export class EmailFeedbackQueueUnavailableError extends Error {
  constructor() {
    super('EMAIL_FEEDBACK_QUEUE_UNAVAILABLE');
    this.name = 'EmailFeedbackQueueUnavailableError';
  }
}
