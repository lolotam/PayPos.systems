import { expect, it } from 'vitest';

import { runStartupRecovery } from '../commission-reminders.ts';
import type { RecoveryOutcome, RecoveryResult } from '../modules/commissions/index.ts';

const result = (outcome: RecoveryOutcome): RecoveryResult => ({
  outcome,
  passId: 'pass',
  companies: 0,
  rebuilt: 0,
  incidentId: null,
});

it('keeps retrying the start-up pass until a certificate is published (never NOTHING_NEEDED)', async () => {
  const outcomes: RecoveryOutcome[] = ['FAILED', 'REFUSED_PACING', 'BUSY', 'NOTHING_NEEDED', 'PUBLISHED'];
  let calls = 0;
  const done = await runStartupRecovery(async () => result(outcomes[calls++] ?? 'PUBLISHED'), {
    signal: new AbortController().signal,
    retryMs: 1,
  });

  expect(done?.outcome).toBe('PUBLISHED');
  expect(calls).toBe(5);
});

it('survives a thrown pass and stops when aborted', async () => {
  const controller = new AbortController();
  let calls = 0;
  const done = await runStartupRecovery(
    async () => {
      calls += 1;
      if (calls === 2) controller.abort();
      throw new Error('redis down');
    },
    { signal: controller.signal, retryMs: 1 },
  );

  expect(done).toBeNull();
  expect(calls).toBe(2);
});
