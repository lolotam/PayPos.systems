import { expect, it } from 'vitest';
import { clockAttendanceInput, clockChallengeInput } from '../staff/clock-attendance.js';

const id = '01920000-0000-7000-8000-0000000000a2';
const encoded = 'c3ludGhldGlj';
const command = {
  token: { branch_id: id, window: 1, sig: 'ab'.repeat(32) },
  challenge_id: id,
  response: {
    id: encoded,
    rawId: encoded,
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: encoded, authenticatorData: encoded, signature: encoded },
  },
};

it('the clock command requires the random v4 installation id and normalizes its case', () => {
  expect(clockAttendanceInput.safeParse(command).success).toBe(false);
  expect(
    clockAttendanceInput.parse({
      ...command,
      installation_id: '12345678-1234-4234-8234-123456789ABC',
    }).installation_id,
  ).toBe('12345678-1234-4234-8234-123456789abc');
  for (const installation_id of [id, 'browser-fingerprint', ''])
    expect(clockAttendanceInput.safeParse({ ...command, installation_id }).success).toBe(false);
});

it('the challenge optionally carries the installation signal', () => {
  expect(
    clockChallengeInput.safeParse({
      token: command.token,
      installation_id: '12345678-1234-4234-8234-123456789abc',
    }).success,
  ).toBe(true);
});
