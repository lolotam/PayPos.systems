import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { TenantWrappers, Tx } from '@pospay/db';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import { packagePreviewFixture, packageWorkbook } from './package-preview.fixture.ts';

const timeoutMs = 30 * 60 * 1000;

it.each(['slot-write', 'deferred-conservation'] as const)(
  'rolls back both phases, audit and outbox on %s failure',
  async (failure) => {
    const f = await packagePreviewFixture();
    try {
      const id = await accept(f, failure);
      const database = failure === 'slot-write' ? failAfterFirstSlotBatch(f.database) : f.database;
      const base = packageImportCommitTransactions(database, f.ids, { timeoutMs });
      const port =
        failure === 'slot-write'
          ? base
          : {
              ...base,
              run: (company: string, preview: string, work: Parameters<typeof base.run>[2]) =>
                base.run(company, preview, (scope) =>
                  work({ ...scope, writeSlots: async () => {} }),
                ),
            };
      const operation = new CommitPackageImport(port, f.clock).execute(f.company, id);
      if (failure === 'slot-write')
        await expect(operation).rejects.toThrow('PACKAGE_IMPORT_COMMIT_RETRY');
      else await operation;
      for (const table of ['package_entitlements', 'package_components', 'package_session_slots']) {
        const [count] = await f.owner`SELECT count(*)::int AS n FROM ${f.owner(table)}`;
        expect(count?.['n']).toBe(0);
      }
      expect(await f.owner`SELECT id FROM audit_log WHERE entity_id=${id}`).toHaveLength(0);
      expect(await f.owner`SELECT id FROM outbox WHERE aggregate_id=${id}`).toHaveLength(0);
      expect(
        (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`)[0],
      ).toMatchObject(
        failure === 'slot-write'
          ? { status: 'commit_requested', error_code: null }
          : { status: 'failed', error_code: 'IMPORT_COMMIT_FAILED' },
      );
      if (failure === 'slot-write') {
        await new CommitPackageImport(
          packageImportCommitTransactions(f.database, f.ids, { timeoutMs }),
          f.clock,
        ).execute(f.company, id);
        expect(
          (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
        ).toMatchObject({ status: 'committed', created_count: 2 });
        expect(
          (await f.owner`SELECT count(*)::int AS n FROM package_session_slots`)[0]?.['n'],
        ).toBe(1460);
      }
    } finally {
      await f.close();
    }
  },
);

async function accept(f: Awaited<ReturnType<typeof packagePreviewFixture>>, prefix: string) {
  const membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
  const { id } = await f.requested(await packageWorkbook(2, 2, prefix));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',commit_membership_id=${membership}
    WHERE id=${id}`),
  );
  return id;
}

function failAfterFirstSlotBatch(
  database: Pick<TenantWrappers, 'withTenant'>,
): Pick<TenantWrappers, 'withTenant'> {
  return {
    withTenant: (company, work, options) =>
      database.withTenant(
        company,
        (tx) => {
          const dialect = new PgDialect();
          return work(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'execute')
                  return async (query: Parameters<Tx['execute']>[0]) => {
                    const text =
                      typeof query === 'string' ? query : dialect.sqlToQuery(query.getSQL()).sql;
                    const result = await target.execute(query);
                    if (text.trimStart().startsWith('INSERT INTO package_session_slots'))
                      throw new Error('synthetic slot storage failure');
                    return result;
                  };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          );
        },
        options,
      ),
  };
}
