import { describe, expect, it } from 'vitest';

import {
  authorizationDecision,
  canTransition,
  isTerminal,
  refusedResult,
  submissionResult,
  type AttemptStatus,
  type NotificationInput,
} from '../attempt-status.ts';
import { closingDeadline, mayClearDestination, mayStart } from '../send-deadline.ts';

const now = new Date('2026-10-01T10:00:00Z');
const input: NotificationInput = {
  companyId: 'test',
  sourceEventId: 'test',
  businessId: null,
  branchId: null,
  phone: '+96500000001',
  identity: { hash: new Uint8Array(32), hashKeyId: 'test-v1', last3: '001', valid: true },
  locale: 'ar',
  channel: 'whatsapp',
  templateKey: 'test_notice',
  templateRevision: 1,
  providerTemplateName: 'test_notice',
  safeParameters: [],
  deadline: null,
  configurationFailure: null,
};

describe('notification lifecycle', () => {
  const statuses: AttemptStatus[] = [
    'PENDING',
    'SENDING',
    'SENT',
    'FAILED',
    'EXPIRED',
    'SUPPRESSED',
  ];
  it.each(statuses)('%s has only the declared irreversible transitions', (from) => {
    const expected =
      from === 'PENDING'
        ? ['SENDING', 'FAILED', 'EXPIRED']
        : from === 'SENDING'
          ? ['SENT', 'FAILED', 'EXPIRED']
          : [];
    for (const to of statuses) expect(canTransition(from, to)).toBe(expected.includes(to));
    expect(isTerminal(from)).toBe(!['PENDING', 'SENDING'].includes(from));
  });
  it.each([null, '', 'fr', 'AR'])(
    'locale %s refuses before other decisions without fallback',
    (locale) => {
      const result = authorizationDecision({ ...input, locale, deadline: now }, now, true);
      expect(result).toEqual({
        status: 'FAILED',
        locale: null,
        failureCode: locale === null || locale === '' ? 'LOCALE_MISSING' : 'LOCALE_UNSUPPORTED',
      });
    },
  );
  it('refuses expired, invalid, suppressed and unconfigured requests without an authorization', () => {
    expect(authorizationDecision({ ...input, deadline: now }, now, false).status).toBe('EXPIRED');
    expect(
      authorizationDecision({ ...input, identity: { ...input.identity, valid: false } }, now, false)
        .failureCode,
    ).toBe('DESTINATION_INVALID');
    expect(authorizationDecision(input, now, true).status).toBe('SUPPRESSED');
    expect(
      authorizationDecision({ ...input, configurationFailure: 'CONFIG_INVALID' }, now, false)
        .failureCode,
    ).toBe('CONFIG_INVALID');
    expect(authorizationDecision(input, now, false).status).toBe('PENDING');
    expect(authorizationDecision({ ...input, locale: 'en' }, now, false).locale).toBe('en');
  });
  it('constructs the terminal refusal states with no provider evidence', () => {
    expect(refusedResult('DEADLINE_EXPIRED').status).toBe('EXPIRED');
    expect(refusedResult('SUPPRESSED').status).toBe('SUPPRESSED');
    expect(refusedResult('CONFIG_INVALID')).toEqual({
      status: 'FAILED',
      failureCode: 'CONFIG_INVALID',
      outcomeKnown: true,
      providerMessageId: null,
    });
  });
});
describe('provider acceptance evidence', () => {
  it('acceptance is SENT; refusal/uncertainty fail without inventing an opaque provider id', () => {
    expect(submissionResult({ kind: 'accepted', providerMessageId: 'test-message-id' })).toEqual({
      status: 'SENT',
      failureCode: null,
      providerMessageId: 'test-message-id',
      outcomeKnown: true,
    });
    expect(submissionResult({ kind: 'expired' }).status).toBe('EXPIRED');
    expect(
      submissionResult({ kind: 'rejected', code: 'PROVIDER_4XX', outcomeKnown: true }),
    ).toMatchObject({ status: 'FAILED', outcomeKnown: true, providerMessageId: null });
    for (const code of ['PROVIDER_5XX', 'NETWORK_UNKNOWN', 'RESPONSE_INVALID'] as const)
      expect(submissionResult({ kind: 'unknown', code, outcomeKnown: false })).toMatchObject({
        status: 'FAILED',
        outcomeKnown: false,
        providerMessageId: null,
      });
  });
});
describe('absolute submission and cleanup deadlines', () => {
  it('supports no deadline and the exact closing plus 30-minute grace', () => {
    expect(mayStart(null, now)).toBe(true);
    expect(closingDeadline(null)).toBeNull();
    expect(closingDeadline(now)?.toISOString()).toBe('2026-10-01T10:30:00.000Z');
    expect(mayStart(now, now)).toBe(false);
    expect(mayStart(new Date(now.getTime() + 1), now)).toBe(true);
  });
  it('requires one day and a drained execution; missing sending time cannot qualify', () => {
    const old = new Date(now.getTime() - 86_400_000);
    expect(mayClearDestination(old, now, true)).toBe(true);
    expect(mayClearDestination(old, now, false)).toBe(false);
    expect(mayClearDestination(null, now, true)).toBe(false);
    expect(mayClearDestination(new Date(old.getTime() + 1), now, true)).toBe(false);
  });
});
