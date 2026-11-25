import { afterAll, beforeAll, expect, it } from 'vitest';
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
    packageImportCommitTransactions(f.database, f.ids, { timeoutMs: 30 * 60 * 1000 }),
    f.clock,
  );
}

it('fails with IMPORT_SERVICE_NOT_FOUND and writes nothing when a service closes after preview (SI-Q28)', async () => {
  const service = f.ids.newId();
  await f.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${service},${f.business},'Closing synthetic service','9.000','FOLLOW_PLAN')`;
  try {
    const bytes = await editPackageWorkbook(
      await packageWorkbook(1, 1, 'closed-after'),
      (sheet) => {
        sheet.getCell('G2').value = 'Closing synthetic service';
      },
    );
    const { id } = await f.requested(bytes);
    await f.worker.execute(f.company, id);
    await f.owner`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${membership} WHERE id=${id}`;
    await f.owner`UPDATE services SET closed_at=now() WHERE id=${service}`;
    await worker().execute(f.company, id);
    expect(
      (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
    ).toMatchObject({ status: 'failed', error_code: 'IMPORT_SERVICE_NOT_FOUND' });
    expect(
      await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
    ).toHaveLength(0);
    expect(
      await f.owner`SELECT s.id FROM package_session_slots s JOIN package_entitlements e
        ON e.company_id=s.company_id AND e.id=s.entitlement_id WHERE e.import_batch_id=${id}`,
    ).toHaveLength(0);
  } finally {
    await f.owner`DELETE FROM services WHERE id=${service}`;
  }
});
