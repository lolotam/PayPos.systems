import { expect, it } from 'vitest';
import { nextBindingRevision, personalMember } from '../passkey-binding.ts';

it('only a covering active membership enables personal scope without business permissions', () => {
  expect(
    personalMember(
      'company',
      'business',
      ['branch'],
      [{ scope_type: 'BRANCH', scope_id: 'branch' }],
    ),
  ).toBe(true);
  expect(
    personalMember(
      'company',
      'business',
      ['branch'],
      [{ scope_type: 'BUSINESS', scope_id: 'other' }],
    ),
  ).toBe(false);
  expect(personalMember('company', 'business', ['branch'], [])).toBe(false);
});
it('a retained history increments revision; an active binding always refuses replacement', () => {
  expect(nextBindingRevision(false, 0)).toBe(1);
  expect(nextBindingRevision(false, 3)).toBe(4);
  expect(() => nextBindingRevision(true, 3)).toThrow('PASSKEY_ALREADY_BOUND');
});
