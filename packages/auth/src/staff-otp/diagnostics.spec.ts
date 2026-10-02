import { expect, it, vi } from 'vitest';
import { phaseRunner } from './diagnostics.ts';

it('reports only reviewed finite diagnostics and never forwards exception text or arbitrary codes', async () => {
  const record = vi.fn(),
    run = phaseRunner(record);
  for (const code of [
    '55P03',
    '57014',
    '25P03',
    'BOUNDED_DATABASE_UNAVAILABLE',
    'BOUNDED_COMMIT_UNKNOWN',
    'BOUNDED_CONNECT_TIMEOUT',
    'SYNTHETIC_UNREVIEWED',
  ]) {
    const error = Object.assign(new Error('synthetic sensitive text'), {
      code,
      params: ['synthetic'],
    });
    await expect(
      run('PREPARATION', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(record).toHaveBeenLastCalledWith(
      'PREPARATION',
      code === 'SYNTHETIC_UNREVIEWED' ? 'OPERATION_FAILED' : code,
    );
  }
  expect(record.mock.calls.flat()).not.toContain('synthetic sensitive text');
  expect(await run('LOOKUP', async () => 7)).toBe(7);
  expect(record).toHaveBeenCalledTimes(7);
});
