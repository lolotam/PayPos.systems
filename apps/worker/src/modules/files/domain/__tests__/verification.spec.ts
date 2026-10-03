import { expect, it } from 'vitest';
import { verificationDeadline } from '../verification.ts';
it('uses injected time for a finite retryable lease', () => {
  const at = new Date('2026-10-01T00:00:00Z');
  expect(verificationDeadline(at).toISOString()).toBe('2026-10-01T00:02:00.000Z');
  expect(at.toISOString()).toBe('2026-10-01T00:00:00.000Z');
});
