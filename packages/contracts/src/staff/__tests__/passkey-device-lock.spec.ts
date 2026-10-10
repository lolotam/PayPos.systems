import { expect, it } from 'vitest';
import { clockChallengeInput, clockAttendanceInput } from '../clock-attendance.js';
import { passkeyOptionsInput, passkeyVerifyInput } from '../passkeys.js';

const installation_id = '12345678-1234-4234-8234-123456789abc';
it('expands challenge and enrollment inputs while retaining the required clock installation', () => {
  expect(clockChallengeInput.shape.installation_id.parse(undefined)).toBeUndefined();
  expect(clockChallengeInput.shape.installation_id.parse(installation_id)).toBe(installation_id);
  expect(clockAttendanceInput.shape.installation_id.safeParse(undefined).success).toBe(false);
  expect(passkeyVerifyInput.shape.installation_id.parse(undefined)).toBeUndefined();
  expect(passkeyVerifyInput.shape.installation_id.parse(installation_id)).toBe(installation_id);
  expect(passkeyOptionsInput.parse(undefined)).toEqual({});
  expect(passkeyOptionsInput.parse({})).toEqual({});
  expect(passkeyOptionsInput.parse({ installation_id })).toEqual({ installation_id });
  expect(passkeyOptionsInput.safeParse({ installation_id: 'invalid' }).success).toBe(false);
});
