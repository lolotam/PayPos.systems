import { expect, it } from 'vitest';
import { attendanceInstallationSignal, unbindPasskeyInput } from '../staff/unbind-passkey.js';
const id = '01920000-0000-7000-8000-0000000000a2';
it('trims the mandatory reason and rejects missing, oversized and extra authority fields', () => {
  expect(
    unbindPasskeyInput.parse({ binding_id: id, revision: 1, reason: '  Synthetic  ' }).reason,
  ).toBe('Synthetic');
  for (const reason of ['', '   ', 'x'.repeat(501)])
    expect(unbindPasskeyInput.safeParse({ binding_id: id, revision: 1, reason }).success).toBe(
      false,
    );
  expect(
    unbindPasskeyInput.safeParse({ binding_id: id, revision: 0, reason: 'Synthetic' }).success,
  ).toBe(false);
  expect(
    unbindPasskeyInput.safeParse({ binding_id: id, revision: 1, reason: 'Synthetic', user_id: id })
      .success,
  ).toBe(false);
});
it('the PR22 signal is a normalized v4 random install id, not arbitrary fingerprint data', () => {
  expect(
    attendanceInstallationSignal.parse({ installation_id: '12345678-1234-4234-8234-123456789ABC' })
      .installation_id,
  ).toBe('12345678-1234-4234-8234-123456789abc');
  expect(attendanceInstallationSignal.safeParse({ installation_id: id }).success).toBe(false);
  expect(
    attendanceInstallationSignal.safeParse({ installation_id: 'arbitrary browser fingerprint' })
      .success,
  ).toBe(false);
});
