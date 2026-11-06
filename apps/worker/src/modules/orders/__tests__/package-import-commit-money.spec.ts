import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import {
  packagePreviewFixture,
  packageWorkbook,
  editPackageWorkbook,
  type PackagePreviewFixture,
} from './package-preview.fixture.ts';
let f: PackagePreviewFixture;
let membership: string;
const timeoutMs = 30 * 60 * 1000; // Benchmark ceiling, not a measured production budget.
beforeAll(async () => {
  f = await packagePreviewFixture();
  membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
});
afterAll(async () => {
  if (f) await f.close();
});
function worker() {
  return new CommitPackageImport(
    packageImportCommitTransactions(f.database, f.ids, { timeoutMs }),
    f.clock,
  );
}
it.each([
  ['10.001', ['1.666', '1.666', '1.666', '1.671']],
  ['0.000', ['0.000', '0.000', '0.000', '0.000']],
  ['99999999999.999', ['16666666666.666', '16666666666.666', '16666666666.666', '16666666666.669']],
])(
  'persists exact batched slot text and ordinals across components at %s',
  async (price, values) => {
    const bytes = await editPackageWorkbook(
      await packageWorkbook(1, 2, `batch-${price}`),
      (sheet) => {
        sheet.getCell('D2').value = price;
        sheet.getCell('H2').value = 3;
        sheet.getCell('I2').value = 2;
        sheet.getCell('K2').value = 3;
        sheet.getCell('L2').value = 1;
      },
    );
    const { id } = await f.requested(bytes);
    await f.worker.execute(f.company, id);
    await f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',commit_membership_id=${membership}
    WHERE id=${id}`),
    );
    await worker().execute(f.company, id);
    const slots = await f.owner`SELECT c.position,s.ordinal,s.unit_value::text AS value,s.state
    FROM package_session_slots s JOIN package_components c
    ON c.company_id=s.company_id AND c.id=s.component_id
    JOIN package_entitlements e ON e.company_id=c.company_id AND e.id=c.entitlement_id
    WHERE e.import_batch_id=${id} ORDER BY c.position,s.ordinal`;
    expect(slots).toEqual([
      { position: 1, ordinal: 1, value: values[0], state: 'IMPORTED_USED' },
      { position: 1, ordinal: 2, value: values[0], state: 'FREE' },
      { position: 1, ordinal: 3, value: values[1], state: 'FREE' },
      { position: 2, ordinal: 1, value: values[2], state: 'IMPORTED_USED' },
      { position: 2, ordinal: 2, value: values[2], state: 'IMPORTED_USED' },
      { position: 2, ordinal: 3, value: values[3], state: 'FREE' },
    ]);
  },
);
