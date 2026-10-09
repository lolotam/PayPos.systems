import postgres from 'postgres';
import { expect, it } from 'vitest';

import { MigrationRoleRefusedError } from '../data-steps/employee-name-keys.ts';
import { appDatabaseUrl, sanitizedStepError } from '../data-steps/index.ts';

it.each(['demo%pass', 'demo%40pass', 'a@b:c/d?e#f', 'plain'])(
  'builds a pospay_app URL that postgres parses back to the exact password %j',
  async (password) => {
    const sql = postgres(appDatabaseUrl('postgres://pospay_owner:x@db:5432/pospay', password));
    try {
      expect(sql.options.user).toBe('pospay_app');
      expect(sql.options.pass).toBe(password);
    } finally {
      await sql.end();
    }
  },
);

it('drops the query text, params and cause, keeping only the SQLSTATE', () => {
  const cause = Object.assign(new Error('new row violates check'), { code: '23514' });
  const failure = Object.assign(new Error('Failed query: UPDATE … params: josé,ساره'), {
    cause,
    params: ['josé', 'ساره'],
  });
  const error = sanitizedStepError('employee-name-keys', failure);
  expect(error.message).toBe('Migration data step employee-name-keys failed (sqlstate=23514)');
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toMatch(/josé|ساره/);
});

it('reports an unknown SQLSTATE when the failure carries none', () => {
  expect(sanitizedStepError('employee-name-keys', new Error('boom josé')).message).toBe(
    'Migration data step employee-name-keys failed (sqlstate=unknown)',
  );
});

it('keeps the fixed role refusal message, which carries no URL, password or row data', () => {
  const refusal = new MigrationRoleRefusedError();
  const error = sanitizedStepError('employee-name-keys', refusal);
  expect(error.message).toBe(refusal.message);
  expect(error.message).not.toMatch(/postgres:|@|password/i);
});
