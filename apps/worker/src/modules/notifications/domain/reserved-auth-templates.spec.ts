import { describe, expect, it } from 'vitest';
import { authorizationDecision, type NotificationInput } from './attempt-status.ts';

const NOW = new Date('2026-11-26T10:00:00Z');

function input(templateKey: string): NotificationInput {
  return {
    companyId: '01920000-0000-7000-8000-000000000001',
    sourceEventId: '01920000-0000-7000-8000-000000000002',
    businessId: null,
    branchId: null,
    phone: '',
    email: 'synthetic.owner@example.invalid',
    identity: { hash: new Uint8Array(32), hashKeyId: 'synthetic', last3: '', valid: true },
    locale: 'en',
    channel: 'email',
    templateKey,
    templateRevision: 1,
    providerTemplateName: null,
    safeParameters: [],
    deadline: null,
    configurationFailure: null,
  };
}

describe('reserved auth templates', () => {
  it.each(['password_reset_otp', 'staff_pin_reset_otp'])(
    'a tenant event can never authorize %s',
    (key) => {
      expect(authorizationDecision(input(key), NOW, false)).toEqual({
        status: 'FAILED',
        locale: 'en',
        failureCode: 'CONFIG_INVALID',
      });
    },
  );

  it('still authorizes the ordinary operational template', () => {
    expect(authorizationDecision(input('document_expiring'), NOW, false)).toMatchObject({
      status: 'PENDING',
    });
  });
});
