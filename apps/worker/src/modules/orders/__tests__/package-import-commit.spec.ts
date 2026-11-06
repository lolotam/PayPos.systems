import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { overlappingBusinesses } from './package-import-commit.fixture.ts';
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
async function accepted(prefix: string, count = 1, groups = 2) {
  const { id } = await f.requested(await packageWorkbook(count, groups, prefix));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${membership} WHERE id=${id}`);
  });
  return id;
}
it('commits exact money, accepted actor, one audit/outbox, and duplicate jobs do nothing', async () => {
  const id = await accepted('commit');
  await Promise.all([worker().execute(f.company, id), worker().execute(f.company, id)]);
  const [result] = await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`;
  expect(result).toMatchObject({ status: 'committed', created_count: 1 });
  const [sum] = await f.owner`SELECT sum(unit_value)::text AS total,count(*)::int AS slots
    FROM package_session_slots s JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id
    WHERE e.import_batch_id=${id}`;
  expect(sum).toMatchObject({ total: '10.001', slots: 730 });
  expect(await f.owner`SELECT * FROM audit_log WHERE entity_id=${id}`).toHaveLength(1);
  expect(
    await f.owner`SELECT * FROM outbox WHERE aggregate_id=${id} AND event_type='ImportCommitted'`,
  ).toHaveLength(1);
  expect(
    (
      await f.owner`SELECT recorded_by_membership_id,provenance,sold_at FROM package_entitlements WHERE import_batch_id=${id}`
    )[0],
  ).toMatchObject({ recorded_by_membership_id: membership, provenance: 'IMPORTED', sold_at: null });
});
it('competing accepted previews skip only external reference conflicts', async () => {
  const a = await accepted('race', 2);
  const b = await accepted('race', 2);
  await Promise.all([worker().execute(f.company, a), worker().execute(f.company, b)]);
  const rows =
    await f.owner`SELECT status,created_count FROM import_previews WHERE id IN (${a},${b})`;
  expect(rows.every((r) => r['status'] === 'committed')).toBe(true);
  expect(rows.reduce((n, r) => n + Number(r['created_count']), 0)).toBe(2);
});
it('rolls back children, audit and summary if completion fails; retry succeeds', async () => {
  const id = await accepted('rollback');
  const base = packageImportCommitTransactions(f.database, f.ids, { timeoutMs });
  const failing = new CommitPackageImport(
    {
      ...base,
      run: (company, preview, work) =>
        base.run(company, preview, (scope) =>
          work({
            ...scope,
            complete: async () => {
              throw new Error('synthetic rollback');
            },
          }),
        ),
    },
    f.clock,
  );
  await expect(failing.execute(f.company, id)).rejects.toThrow('PACKAGE_IMPORT_COMMIT_RETRY');
  expect(
    await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
  ).toHaveLength(0);
  expect(await f.owner`SELECT id FROM audit_log WHERE entity_id=${id}`).toHaveLength(0);
  await worker().execute(f.company, id);
});
it('does not expose or change another tenant preview', async () => {
  const id = await accepted('tenant');
  await worker().execute(f.otherCompany, id);
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'commit_requested',
  );
});

it('freezes accepted membership, proof, results and terminal rows', async () => {
  const id = await accepted('guards');
  const forbidden = [
    sql`commit_membership_id=NULL`,
    sql`source_rows='[]'::jsonb`,
    sql`skipped_rows='[2]'::jsonb`,
    sql`rows='[]'::jsonb`,
    sql`created_count=1`,
    sql`requested_at='2026-11-05T13:00:00Z'`,
    sql`status='ready'`,
  ];
  for (const change of forbidden)
    await expect(
      f.db.withTenant(f.company, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET ${change} WHERE id=${id}`);
      }),
    ).rejects.toThrow();
  await worker().execute(f.company, id);
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`UPDATE import_previews SET created_count=0 WHERE id=${id}`);
    }),
  ).rejects.toThrow();
});
it('refuses mismatched accepted membership FK and legacy proof without reread', async () => {
  const { id } = await f.requested(await packageWorkbook(1, 2, 'fk'));
  await f.worker.execute(f.company, id);
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${f.ids.newId()} WHERE id=${id}`);
    }),
  ).rejects.toThrow();
  const legacy = f.ids.newId();
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
    status,row_count,error_count,rows,errors)
    SELECT company_id,${legacy},business_id,entity,file_id,created_by,created_at,expires_at,'ready',0,0,'[]','[]'
    FROM import_previews WHERE id=${id}`;
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${membership} WHERE id=${legacy}`);
    }),
  ).rejects.toMatchObject({ cause: { code: '23514', message: 'IMPORT_PREVIEW_EXPIRED' } });
});
it('app privileges refuse delete and cross-tenant mutations', async () => {
  const id = await accepted('privilege');
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM import_previews WHERE id=${id}`)).toHaveLength(0);
    await tx.execute(
      sql`UPDATE import_previews SET status='failed',error_code='IMPORT_COMMIT_FAILED' WHERE id=${id}`,
    );
  });
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'commit_requested',
  );
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`DELETE FROM import_previews WHERE id=${id}`);
    }),
  ).rejects.toThrow();
});

it('commits an all-skipped preview and leaves the stored proof unchanged', async () => {
  const first = await accepted('all-skipped');
  await worker().execute(f.company, first);
  const id = await accepted('all-skipped');
  const [before] =
    await f.owner`SELECT rows,errors,source_rows,skipped_rows,skipped_count FROM import_previews WHERE id=${id}`;
  await worker().execute(f.company, id);
  const [after] =
    await f.owner`SELECT rows,errors,source_rows,skipped_rows,skipped_count FROM import_previews WHERE id=${id}`;
  expect(after).toEqual(before);
  expect(
    (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', created_count: 0 });
  expect(
    (
      await f.owner`SELECT payload FROM outbox WHERE aggregate_id=${id} AND event_type='ImportCommitted'`
    )[0]?.['payload'],
  ).toMatchObject({ created_count: 0, skipped_count: 1 });
});
it('fails a missing referenced service safely without partial financial writes', async () => {
  const service = f.ids.newId();
  await f.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${service},${f.business},'Transient synthetic service','9.000','FOLLOW_PLAN')`;
  const bytes = await editPackageWorkbook(
    await packageWorkbook(1, 1, 'missing-service'),
    (sheet) => {
      sheet.getCell('G2').value = 'Transient synthetic service';
    },
  );
  const { id } = await f.requested(bytes);
  await f.worker.execute(f.company, id);
  await f.owner`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
    commit_membership_id=${membership} WHERE id=${id}`;
  await f.owner`DELETE FROM services WHERE id=${service}`;
  await worker().execute(f.company, id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_SERVICE_NOT_FOUND' });
  expect(
    await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
  ).toHaveLength(0);
});

it('does not skip unrelated unique violations and rolls the whole import back', async () => {
  const id = await accepted('unrelated-unique');
  const repeated = f.ids.newId();
  const brokenIds = { newId: () => repeated };
  const invalid = new CommitPackageImport(
    packageImportCommitTransactions(f.database, brokenIds, { timeoutMs }),
    f.clock,
  );
  await invalid.execute(f.company, id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
  expect(
    await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
  ).toHaveLength(0);
});

it('rejects an existing membership belonging to a different accepted user', async () => {
  const user = f.ids.newId();
  const other = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${user},'Synthetic other','other-commit@example.test')`;
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${other},${user},${role?.['id']},'global','COMPANY',${f.company})`;
  const { id } = await f.requested(await packageWorkbook(1, 1, 'other-user'));
  await f.worker.execute(f.company, id);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',commit_membership_id=${other} WHERE id=${id}`),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23503', constraint_name: 'import_previews_commit_membership_fk' },
  });
  expect(
    (await f.owner`SELECT status,commit_membership_id FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'ready', commit_membership_id: null });
});

it('isolates failure finalization by tenant, entity and terminal state', async () => {
  const id = await accepted('failure-isolation');
  const base = packageImportCommitTransactions(f.database, f.ids, { timeoutMs });
  await base.fail(f.otherCompany, id, 'IMPORT_COMMIT_FAILED');
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'commit_requested',
  );
  await worker().execute(f.company, id);
  await base.fail(f.company, id, 'IMPORT_COMMIT_FAILED');
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'committed',
  );
  const failed = await accepted('terminal-failure');
  await base.fail(f.company, failed, 'IMPORT_SERVICE_NOT_FOUND');
  await base.fail(f.company, failed, 'IMPORT_COMMIT_FAILED');
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${failed}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_SERVICE_NOT_FOUND' });
  const { id: source } = await f.requested(await packageWorkbook());
  const staff = f.ids.newId();
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors,requested_at)
    SELECT company_id,${staff},business_id,'employees',file_id,created_by,created_at,expires_at,'commit_requested',0,0,'[]','[]','2026-11-05T12:00:00Z' FROM import_previews WHERE id=${source}`;
  await base.fail(f.company, staff, 'IMPORT_COMMIT_FAILED');
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${staff}`)[0]?.['status']).toBe(
    'commit_requested',
  );
});

it('maps a genuine unknown FK refusal and rolls back every financial write', async () => {
  const id = await accepted('unknown-fk', 2, 1);
  const base = packageImportCommitTransactions(f.database, f.ids, { timeoutMs });
  const missing = f.ids.newId();
  const invalid = new CommitPackageImport(
    {
      ...base,
      run: (company, preview, work) =>
        base.run(company, preview, (scope) =>
          work({
            ...scope,
            insert: (row, at) =>
              scope.insert(
                {
                  ...row,
                  customer_id: row.external_ref.endsWith('-1') ? missing : row.customer_id,
                },
                at,
              ),
          }),
        ),
    },
    f.clock,
  );
  await invalid.execute(f.company, id);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' });
  expect(
    await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${id}`,
  ).toHaveLength(0);
  expect(await f.owner`SELECT id FROM audit_log WHERE entity_id=${id}`).toHaveLength(0);
  expect(await f.owner`SELECT id FROM outbox WHERE aggregate_id=${id}`).toHaveLength(0);
});

it.each([false, true])(
  'orders overlapping company refs across businesses; competitor rollback=%s',
  async (rollback) => {
    const { a, b } = await overlappingBusinesses(f, membership, `ordered-${rollback}`);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const orders: [string[], string[]] = [[], []];
    const first = trackedWorker(orders[0], async () => {
      entered();
      await gate;
      if (rollback) throw new Error('competitor rollback');
    });
    const second = trackedWorker(orders[1]);
    const one = first.execute(f.company, a).then(
      () => null,
      (error) => error as Error,
    );
    await inserted;
    const two = second.execute(f.company, b);
    try {
      await vi.waitFor(
        async () => {
          const [locks] =
            await f.owner`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='transactionid' AND NOT granted`;
          expect(Number(locks?.['n'])).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
    } finally {
      release();
    }
    const [failure] = await Promise.all([one, two]);
    expect(failure?.message ?? null).toBe(rollback ? 'PACKAGE_IMPORT_COMMIT_RETRY' : null);
    expect(orders[0]).toEqual([`ordered-${rollback}-0`, `ordered-${rollback}-1`]);
    expect(orders[1]).toEqual(orders[0]);
    expect(
      (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${b}`)[0],
    ).toMatchObject({ status: 'committed', created_count: rollback ? 2 : 0 });
    expect(
      await f.owner`SELECT id FROM package_entitlements WHERE import_batch_id=${rollback ? a : b}`,
    ).toHaveLength(0);
    expect(
      await f.owner`SELECT id FROM audit_log WHERE entity_id=${rollback ? a : b}`,
    ).toHaveLength(rollback ? 0 : 1);
    expect(
      await f.owner`SELECT id FROM package_entitlements WHERE external_ref LIKE ${`ordered-${rollback}-%`}`,
    ).toHaveLength(2);
  },
  15000,
);

function trackedWorker(order: string[], beforeComplete?: () => Promise<void>) {
  const base = packageImportCommitTransactions(f.database, f.ids, { timeoutMs });
  return new CommitPackageImport(
    {
      ...base,
      run: (company, preview, work) =>
        base.run(company, preview, (scope) =>
          work({
            ...scope,
            insert: (row, at) => {
              order.push(row.external_ref);
              return scope.insert(row, at);
            },
            complete: async (count, at) => {
              await beforeComplete?.();
              await scope.complete(count, at);
            },
          }),
        ),
    },
    f.clock,
  );
}
