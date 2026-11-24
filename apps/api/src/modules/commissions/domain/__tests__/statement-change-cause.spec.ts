import { describe, expect, it } from 'vitest';

import { statementChangeCause } from '../statement-change-cause.ts';

const reviewed = { input: 'a'.repeat(64), statement: 'b'.repeat(64) };

describe('the cause of a statement changed since review (D-26)', () => {
  it.each([
    ['nothing changed', reviewed, null],
    [
      'only the statement fingerprint changed',
      { ...reviewed, statement: 'c'.repeat(64) },
      'STATEMENT',
    ],
    ['only the input fingerprint changed', { ...reviewed, input: 'c'.repeat(64) }, 'INPUTS'],
    [
      'both changed, the cause reported is INPUTS',
      { input: 'd'.repeat(64), statement: 'c'.repeat(64) },
      'INPUTS',
    ],
  ] as const)('%s', (_name, current, expected) => {
    expect(statementChangeCause(reviewed, current)).toBe(expected);
  });
});
