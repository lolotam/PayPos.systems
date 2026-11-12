import { describe, expect, it } from 'vitest';

import { extendPackageInput, packageExtensionResponse } from './package-extension.js';

const id = '00000000-0000-7000-8000-000000000001';
const input = {
  new_expires_on: '2027-01-31',
  expected_expires_on: '2026-12-30',
  reason: 'Customer requested more time',
};

describe('extendPackageInput', () => {
  it('accepts exactly the extension command fields', () => {
    expect(extendPackageInput.parse(input)).toEqual(input);
  });

  it('rejects an unknown amount or any other additional field', () => {
    expect(extendPackageInput.safeParse({ ...input, amount: '10.000' }).success).toBe(false);
    expect(extendPackageInput.safeParse({ ...input, revision: 2 }).success).toBe(false);
  });

  it.each(['new_expires_on', 'expected_expires_on', 'reason'])(
    'rejects a missing %s field',
    (field) => {
      const incomplete = Object.fromEntries(
        Object.entries(input).filter(([candidate]) => candidate !== field),
      );
      expect(extendPackageInput.safeParse(incomplete).success).toBe(false);
    },
  );

  it.each(['2026-13-01', '2026-1-1', '2026-02-30'])(
    'rejects malformed calendar date %s in either date field',
    (date) => {
      expect(extendPackageInput.safeParse({ ...input, new_expires_on: date }).success).toBe(false);
      expect(extendPackageInput.safeParse({ ...input, expected_expires_on: date }).success).toBe(
        false,
      );
    },
  );
});

describe('packageExtensionResponse', () => {
  it('models only the stored extension facts and never echoes reason or money', () => {
    const response = {
      id,
      entitlement_id: id,
      previous_expires_on: '2026-12-30',
      new_expires_on: '2027-01-31',
      extended_at: '2026-10-21T08:00:00.000Z',
    };
    expect(packageExtensionResponse.parse(response)).toEqual(response);
    expect(packageExtensionResponse.safeParse({ ...response, extended_at: 'not-a-date' }).success).toBe(
      false,
    );
  });
});
