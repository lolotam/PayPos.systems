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

it('preserves capability failure reasons outside salary-shaped objects', () => {
  const diagnostic = {
    capability: { name: 'TENANT_WHATSAPP', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' },
    emailStartup: { state: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' },
    otpStartup: { state: 'UNAVAILABLE', reason: 'SETUP_FAILED' },
  };
  expect(sanitize(diagnostic)).toMatchObject({
    capability: diagnostic.capability,
    emailStartup: diagnostic.emailStartup,
    otpStartup: diagnostic.otpStartup,
  });
});

it('redacts SalaryChanged-like records and nested audit reasons without changing stored audit', () => {
  const entry = { effective_from: '2026-10-03', amount: '765.432', reason: 'Synthetic correction' };
  const event = { type: 'SalaryChanged', ...entry, revision: 2 };
  const audit = { before: entry, after: [{ ...entry, amount: 765432n }] };
  const hidden = { effective_from: entry.effective_from, amount: REDACTED, reason: REDACTED };
  expect(sanitize({ event, audit, salaries: [entry], salary: { reason: entry.reason } })).toEqual({
    event: { type: 'SalaryChanged', ...hidden, revision: 2 },
    audit: { before: hidden, after: [hidden] },
    salaries: REDACTED,
    salary: REDACTED,
  });
  expect(sanitize({ effective_from: entry.effective_from, reason: entry.reason })).toEqual({
    effective_from: entry.effective_from,
    reason: REDACTED,
  });
  expect(redactSecrets({ event, audit })).toEqual({
    event,
    audit: { before: entry, after: [{ ...entry, amount: '765432' }] },
  });
});
