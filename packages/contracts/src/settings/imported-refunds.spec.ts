import { expect, it } from 'vitest';

import { importedRefundsResponse, setImportedRefundsInput } from './imported-refunds.js';

it('the write accepts exactly one required boolean', () => {
  expect(setImportedRefundsInput.parse({ imported_refunds_enabled: true })).toEqual({
    imported_refunds_enabled: true,
  });
  expect(setImportedRefundsInput.parse({ imported_refunds_enabled: false })).toEqual({
    imported_refunds_enabled: false,
  });
});

it.each([
  {},
  { imported_refunds_enabled: 'true' },
  { imported_refunds_enabled: null },
  { imported_refunds_enabled: true, reason: 'now' },
])('refuses %j', (body) => {
  expect(setImportedRefundsInput.safeParse(body).success).toBe(false);
});

it('the response carries the effective boolean', () => {
  expect(importedRefundsResponse.parse({ imported_refunds_enabled: false })).toEqual({
    imported_refunds_enabled: false,
  });
  expect(importedRefundsResponse.safeParse({ imported_refunds_enabled: 'off' }).success).toBe(
    false,
  );
});
