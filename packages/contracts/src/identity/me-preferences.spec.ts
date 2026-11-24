import { describe, expect, it } from 'vitest';

import { myPreferencesResponse, setMyPreferencesInput } from './me-preferences.js';

describe('personal navigation preference contract', () => {
  it.each(['A', 'B', 'C', null])('accepts %s and preserves the response shape', (navStyle) => {
    expect(setMyPreferencesInput.parse({ navStyle })).toEqual({ navStyle });
    expect(myPreferencesResponse.parse({ navStyle })).toEqual({ navStyle });
  });
  it.each([{ navStyle: 'D' }, {}, { navStyle: 1 }, { navStyle: 'A', userId: 'other' }])(
    'refuses invalid input or a selector: %j',
    (body) => expect(setMyPreferencesInput.safeParse(body).success).toBe(false),
  );
});
