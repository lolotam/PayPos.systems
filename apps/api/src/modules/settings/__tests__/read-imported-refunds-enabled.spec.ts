import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  permissionFixture,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { readImportedRefundsEnabled } from '../index.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const read = () =>
  f.db.withTenant(f.company, (tx) => readImportedRefundsEnabled(tx, f.company, f.business));

const store = (value: boolean | null) =>
  f.h.owner`INSERT INTO business_settings(company_id,business_id,imported_refunds_enabled)
    VALUES(${f.company},${f.business},${value})
    ON CONFLICT (company_id,business_id) DO UPDATE SET imported_refunds_enabled=${value}`;

it('is true only when the business stored true', async () => {
  await store(true);
  expect(await read()).toBe(true);
});

it('is false for a stored false and for a stored null', async () => {
  await store(false);
  expect(await read()).toBe(false);
  await store(null);
  expect(await read()).toBe(false);
});

it('is false for a business with no settings row at all', async () => {
  await f.h.owner`DELETE FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(await read()).toBe(false);
});

it('never creates a settings row while reading', async () => {
  await f.h.owner`DELETE FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(await read()).toBe(false);
  expect(
    await f.h.owner`SELECT count(*)::int AS rows FROM business_settings
      WHERE company_id=${f.company} AND business_id=${f.business}`,
  ).toEqual([{ rows: 0 }]);
});
