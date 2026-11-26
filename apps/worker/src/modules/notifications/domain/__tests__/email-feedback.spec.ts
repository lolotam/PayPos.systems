import { expect, it } from 'vitest';

import {
  emailFeedbackDecision,
  evaluateAttemptBinding,
  nextFeedbackRetry,
  MAX_FEEDBACK_ATTEMPTS,
  MAX_FEEDBACK_BACKOFF_MS,
  type AttemptBindingSnapshot,
  type RetrievedBindingTarget,
} from '../email-feedback.ts';

const COMPANY = '01920000-0000-7000-8000-000000000001';
const OTHER = '01920000-0000-7000-8000-000000000009';
const EXECUTION = '01920000-0000-7000-8000-000000000003';
const PROVIDER_ID = '01920000-0000-7000-8000-000000000004';
const HASH = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function attempt(overrides: Partial<AttemptBindingSnapshot> = {}): AttemptBindingSnapshot {
  return {
    companyId: COMPANY,
    channel: 'email',
    executionId: EXECUTION,
    status: 'SENDING',
    outcomeKnown: null,
    providerMessageId: null,
    recipientHash: HASH,
    hashKeyId: 'email-test-v1',
    ...overrides,
  };
}

function target(overrides: Partial<RetrievedBindingTarget> = {}): RetrievedBindingTarget {
  return {
    companyId: COMPANY,
    executionId: EXECUTION,
    providerEmailId: PROVIDER_ID,
    recipientHash: HASH,
    hashKeyId: 'email-test-v1',
    ...overrides,
  };
}

it('suppresses a complaint, a provider suppression and a permanent bounce', () => {
  expect(emailFeedbackDecision('email.complained', null)).toEqual({
    suppress: true,
    source: 'COMPLAINT',
    reason: 'COMPLAINT',
  });
  expect(emailFeedbackDecision('email.suppressed', null)).toEqual({
    suppress: true,
    source: 'PROVIDER',
    reason: 'PROVIDER_SUPPRESSION',
  });
  expect(emailFeedbackDecision('email.bounced', 'PERMANENT')).toEqual({
    suppress: true,
    source: 'BOUNCE',
    reason: 'PERMANENT_BOUNCE',
  });
});

it('keeps a transient bounce, an unknown bounce, a delay, a delivery and a failure as evidence', () => {
  expect(emailFeedbackDecision('email.bounced', 'TRANSIENT')).toEqual({ suppress: false });
  expect(emailFeedbackDecision('email.bounced', null)).toEqual({ suppress: false });
  expect(emailFeedbackDecision('email.delivery_delayed', null)).toEqual({ suppress: false });
  expect(emailFeedbackDecision('email.delivered', null)).toEqual({ suppress: false });
  expect(emailFeedbackDecision('email.failed', null)).toEqual({ suppress: false });
});

it('refuses a missing attempt, a foreign company and a foreign channel', () => {
  expect(evaluateAttemptBinding(null, target())).toEqual({
    ok: false,
    reason: 'ATTEMPT_NOT_FOUND',
  });
  expect(evaluateAttemptBinding(attempt({ companyId: OTHER }), target())).toEqual({
    ok: false,
    reason: 'CROSS_TENANT',
  });
  expect(evaluateAttemptBinding(attempt({ channel: 'whatsapp' }), target())).toEqual({
    ok: false,
    reason: 'STATE_INELIGIBLE',
  });
});

it('refuses a missing execution, a different execution and a different hash', () => {
  expect(evaluateAttemptBinding(attempt({ executionId: null }), target())).toEqual({
    ok: false,
    reason: 'EXECUTION_MISSING',
  });
  expect(evaluateAttemptBinding(attempt(), target({ executionId: OTHER }))).toEqual({
    ok: false,
    reason: 'EXECUTION_MISSING',
  });
  const otherHash = Uint8Array.from({ length: 32 }, (_, index) => index + 2);
  expect(evaluateAttemptBinding(attempt(), target({ recipientHash: otherHash }))).toEqual({
    ok: false,
    reason: 'HASH_MISMATCH',
  });
  expect(evaluateAttemptBinding(attempt(), target({ hashKeyId: 'other-key' }))).toEqual({
    ok: false,
    reason: 'HASH_MISMATCH',
  });
});

it('refuses a provider id that belongs to another send', () => {
  expect(evaluateAttemptBinding(attempt({ providerMessageId: OTHER }), target())).toEqual({
    ok: false,
    reason: 'PROVIDER_ID_CONFLICT',
  });
});

it('binds a missing provider id while the attempt can still change', () => {
  expect(evaluateAttemptBinding(attempt({ status: 'SENDING' }), target())).toEqual({
    ok: true,
    bindProviderMessageId: true,
  });
  expect(
    evaluateAttemptBinding(attempt({ status: 'FAILED', outcomeKnown: false }), target()),
  ).toEqual({ ok: true, bindProviderMessageId: true });
});

it('accepts a bound provider id as idempotent in the states that still hold evidence', () => {
  for (const status of ['SENDING', 'SENT']) {
    expect(
      evaluateAttemptBinding(attempt({ status, providerMessageId: PROVIDER_ID }), target()),
    ).toEqual({ ok: true, bindProviderMessageId: false });
  }
  expect(
    evaluateAttemptBinding(
      attempt({ status: 'FAILED', outcomeKnown: false, providerMessageId: PROVIDER_ID }),
      target(),
    ),
  ).toEqual({ ok: true, bindProviderMessageId: false });
});

it('refuses an ineligible state in both directions', () => {
  expect(
    evaluateAttemptBinding(attempt({ status: 'SENT', providerMessageId: null }), target()),
  ).toEqual({ ok: false, reason: 'STATE_INELIGIBLE' });
  expect(
    evaluateAttemptBinding(attempt({ status: 'FAILED', outcomeKnown: true }), target()),
  ).toEqual({ ok: false, reason: 'STATE_INELIGIBLE' });
  expect(
    evaluateAttemptBinding(
      attempt({ status: 'EXPIRED', providerMessageId: PROVIDER_ID }),
      target(),
    ),
  ).toEqual({ ok: false, reason: 'STATE_INELIGIBLE' });
  expect(
    evaluateAttemptBinding(
      attempt({ status: 'SUPPRESSED', providerMessageId: PROVIDER_ID }),
      target(),
    ),
  ).toEqual({ ok: false, reason: 'STATE_INELIGIBLE' });
});

it('doubles the retry spacing and caps it at six hours', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const first = nextFeedbackRetry(1, now);
  expect(first.quarantine).toBeNull();
  if (first.quarantine !== null) return;
  expect(first.nextAttemptAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
  const seventh = nextFeedbackRetry(MAX_FEEDBACK_ATTEMPTS - 1, now);
  expect(seventh.quarantine).toBeNull();
  if (seventh.quarantine !== null) return;
  expect(seventh.nextAttemptAt.getTime() - now.getTime()).toBe(MAX_FEEDBACK_BACKOFF_MS);
});

it('quarantines the row once the retrieval attempts are exhausted', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  expect(nextFeedbackRetry(MAX_FEEDBACK_ATTEMPTS, now)).toEqual({
    quarantine: 'RETRIEVAL_EXHAUSTED',
  });
  expect(nextFeedbackRetry(MAX_FEEDBACK_ATTEMPTS + 3, now)).toEqual({
    quarantine: 'RETRIEVAL_EXHAUSTED',
  });
});
