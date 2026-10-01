import { expect, it } from 'vitest';
import { sanitize, redactSecrets } from '../redaction.ts';

it('drops notification source/job/provider payloads and embedded phones from diagnostics', () => {
  const value = {
    payload: { notification_recipients: [{ phone: '+96500000001' }] },
    provider_body: 'untrusted response',
    safe_parameters: [{ value: 'test-token' }],
    detail: 'destination +96500000001 failed',
    phone_last3: '001',
    template_key: 'test_notice',
  };
  expect(sanitize(value)).toMatchObject({
    payload: '[REDACTED]',
    provider_body: '[REDACTED]',
    safe_parameters: '[REDACTED]',
    detail: 'destination ***001 failed',
    phone_last3: '001',
  });
  expect(JSON.stringify(sanitize(value))).not.toContain('+96500000001');
  expect(redactSecrets({ phone: '+96500000001' })).toEqual({ phone: '+96500000001' });
});
