import { z } from 'zod';

// The six feedback events the intake stores (spec 075 FR-003). Any other event is acknowledged with
// 200 and dropped, so the list is closed on purpose.
export const RESEND_FEEDBACK_EVENT_TYPES = [
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
  'email.delivery_delayed',
] as const;

// The bounce classification we store. It is our own vocabulary, not Resend's wording: the provider
// value is normalised into it and an unknown value stays unknown instead of guessing.
export const RESEND_FEEDBACK_BOUNCE_CLASSES = ['PERMANENT', 'TRANSIENT'] as const;

// The fixed reason codes a quarantined inbox row may carry. The worker writes them; the intake only
// has to know that the column holds one of them.
export const RESEND_FEEDBACK_QUARANTINE_REASONS = [
  'TAGS_INVALID',
  'RETRIEVAL_EXHAUSTED',
  'ATTEMPT_NOT_FOUND',
  'HASH_MISMATCH',
  'STATE_INELIGIBLE',
  'EXECUTION_MISSING',
  'PROVIDER_ID_CONFLICT',
  'CROSS_TENANT',
] as const;

export const resendFeedbackEventType = z.enum([...RESEND_FEEDBACK_EVENT_TYPES]);
export const resendFeedbackBounceClass = z.enum([...RESEND_FEEDBACK_BOUNCE_CLASSES]);
export const resendFeedbackQuarantineReason = z.enum([...RESEND_FEEDBACK_QUARANTINE_REASONS]);

/** The event type of a feedback body, read before the allowlist decides whether we keep it. */
export const resendFeedbackType = z.object({ type: z.string().min(1).max(64) });

/**
 * The signed envelope we accept. Only the allowlisted fields survive the parse: addresses, subject,
 * headers, tags and every bounce diagnostic are dropped before anything is stored or logged.
 */
export const resendFeedbackEnvelope = z
  .object({
    type: z.string().min(1).max(64),
    created_at: z.string().min(1).max(64),
    data: z.object({
      email_id: z.string().min(1).max(256),
      bounce: z.object({ type: z.string().min(1).max(64) }).optional(),
    }),
  })
  .meta({ id: 'ResendFeedbackEnvelope' });

/** The scrubbed envelope stored as the inbox row payload: identifiers, timestamps and nothing else. */
export const resendFeedbackScrubbed = z
  .object({
    type: resendFeedbackEventType,
    created_at: z.string().min(1).max(64),
    email_id: z.string().min(1).max(256),
    bounce_type: z.string().min(1).max(64).optional(),
  })
  .meta({ id: 'ResendFeedbackScrubbed' });

export const resendFeedbackAcknowledgement = z
  .object({ received: z.literal(true) })
  .meta({ id: 'ResendFeedbackAcknowledgement' });

export type ResendFeedbackEnvelope = z.infer<typeof resendFeedbackEnvelope>;
export type ResendFeedbackScrubbed = z.infer<typeof resendFeedbackScrubbed>;
export type ResendFeedbackEventType = (typeof RESEND_FEEDBACK_EVENT_TYPES)[number];
export type ResendFeedbackBounceClass = (typeof RESEND_FEEDBACK_BOUNCE_CLASSES)[number];

/** tells whether the event is one of the six we keep; the others are acknowledged and dropped */
export function isStoredResendFeedbackType(type: string): type is ResendFeedbackEventType {
  return (RESEND_FEEDBACK_EVENT_TYPES as readonly string[]).includes(type);
}
