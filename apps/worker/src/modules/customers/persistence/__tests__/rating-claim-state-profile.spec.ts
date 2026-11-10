import { expect, it } from 'vitest';
import { projectSlowlogRows } from './rating-claim-state-profile.fixture.ts';
it('projects only the three numeric fields and omits synthetic sensitive fields', () => {
  const row = [41, 1768000000, 12345, ['EVAL', 'SECRET'], 'CLIENT'];
  expect(projectSlowlogRows([row])).toEqual([[41, 1768000000, 12345]]);
});
it.each([
  [[1, 2]],
  [['1', 2, 3]],
  [[1, 2, -1]],
  [[1, Number.NaN, 3]],
  [['SLOWLOG-SENTINEL', 2, 3]],
])('fails closed on %j', (reply) => {
  expect(projectSlowlogRows([reply])).toBeUndefined();
});
