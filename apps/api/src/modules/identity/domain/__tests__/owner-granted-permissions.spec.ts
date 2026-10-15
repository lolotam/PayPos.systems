import { expect, it } from 'vitest';
import { OWNER_GRANTED_PERMISSIONS } from '@pospay/db';
import { OWNER_GRANTED_PERMISSIONS as domainOwnerGranted } from '../permission-edit.ts';

it('the domain owner-granted list matches the reference list in packages/db', () => {
  expect(domainOwnerGranted.length).toBeGreaterThan(0);
  expect([...domainOwnerGranted].sort()).toEqual([...OWNER_GRANTED_PERMISSIONS].sort());
});
