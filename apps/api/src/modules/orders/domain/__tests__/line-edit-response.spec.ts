import { expect, it } from 'vitest';
import { projectEditResponse } from '../line-edit-response.ts';

const full = {
  line: { edited: true as const, price: '20.000', discount: '5.000', net: '20.000', revision: 2 },
  session: { id: 'session', total_net: '20.000' },
};

it('returns the full body unchanged when the caller can read the visit', () => {
  expect(projectEditResponse(full, true)).toBe(full);
});

it('returns only the saved mark when the caller cannot read the visit', () => {
  const projected = projectEditResponse(full, false);
  expect(projected).toEqual({ saved: true, edited: true });
  expect(Object.keys(projected).sort()).toEqual(['edited', 'saved']);
  expect(full.line.price).toBe('20.000');
});
