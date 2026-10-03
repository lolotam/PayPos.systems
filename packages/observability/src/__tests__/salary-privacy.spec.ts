import { Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { createLogger } from '../logger.ts';
import { redactSecrets, sanitize, REDACTED } from '../redaction.ts';
it('redacts standalone/nested salary amounts and reasons but retains financial audit amounts', () => {
  const record = {
    amount: '765.432',
    before: { AMOUNT: 765432n },
    after: [{ salaryAmount: '765.432', monthly_basic_salary: '765.432' }],
    reason: 'Salary 765.432',
  };
  expect(sanitize(record)).toEqual({
    amount: REDACTED,
    before: { AMOUNT: REDACTED },
    after: [{ salaryAmount: REDACTED, monthly_basic_salary: REDACTED }],
    reason: REDACTED,
  });
  expect(redactSecrets(record)).toMatchObject({ amount: '765.432', reason: 'Salary 765.432' });
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  createLogger('info', { destination: sink, events: ['probe'] }).info(record, 'probe');
  expect(written).not.toContain('765.432');
  expect(written).not.toContain('765432');
});
