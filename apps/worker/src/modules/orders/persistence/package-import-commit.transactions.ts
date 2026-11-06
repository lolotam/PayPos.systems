import {
  appendAuditLog,
  appendOutboxEvent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { readPackageCommitServices } from '../../catalog/index.ts';
import { PackageCommitError, packageCommitCounts } from '../domain/package-import-commit.ts';
import type {
  PackageCommitScope,
  PackageCommitTransactions,
} from '../ports/package-import-commit.port.ts';
import { parsePackageCommitPreview } from './package-import-commit.schema.ts';
import { insertPackageImport } from './package-import-commit.writes.ts';

// Deployment must supply a measured full-bound transaction budget. No staff 15-second default.
export function packageImportCommitTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  options: { timeoutMs: number },
): PackageCommitTransactions {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
    throw new TypeError('timeoutMs must be positive');
  return {
    run: (companyId, previewId, work) =>
      database
        .withTenant(
          companyId,
          async (tx) => {
            const preview = await loadPreview(tx, companyId, previewId);
            if (preview === null) return;
            const names = new Map<
              string,
              { id: string; name_en: string; name_ar: string | null }
            >();
            await work({
              preview,
              lockServices: async (rows) => {
                const refs = [
                  ...new Set(rows.flatMap((row) => row.components.map((c) => c.service_id))),
                ];
                for (const service of await readPackageCommitServices(
                  tx,
                  companyId,
                  preview.business_id,
                  refs,
                ))
                  names.set(service.id, service);
                if (names.size !== refs.length)
                  throw new PackageCommitError('IMPORT_SERVICE_NOT_FOUND');
              },
              insert: (row, at) =>
                insertPackageImport({ tx, ids, company: companyId, preview, names }, row, at),
              complete: (created, at) =>
                completePreview({ tx, ids, companyId, preview }, created, at),
            });
          },
          options,
        )
        .catch(mapSqlError),
    fail: async (companyId, previewId, code) => {
      await database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET status='failed',error_code=${code}
          WHERE company_id=${companyId} AND id=${previewId} AND entity='packages' AND status='commit_requested'`);
      });
    },
  };
}

/** يقفل طلب الباقات ويحمّل المعاينة ويضبط هوية منشئها داخل المعاملة. */
async function loadPreview(tx: Tx, companyId: string, previewId: string) {
  const [stored] = await tx.execute<Record<string, unknown>>(sql`SELECT id,business_id,created_by,
        commit_membership_id,requested_at,expires_at,row_count,error_count,skipped_count,source_rows,skipped_rows,rows,errors
        FROM import_previews WHERE company_id=${companyId} AND id=${previewId} AND entity='packages'
        AND status='commit_requested' FOR UPDATE`);
  if (stored === undefined) return null;
  await tx.execute(sql`SELECT set_config('app.user_id',${stored['created_by'] as string},true)`);
  const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
  const preview = parsePackageCommitPreview({
    ...stored,
    requested_at: timestamp(stored['requested_at']),
    expires_at: timestamp(stored['expires_at']),
  });
  return preview;
}

/** يكتب ملخص التدقيق والحدث والحالة ضمن معاملة الكتابات المالية نفسها. */
async function completePreview(
  context: {
    tx: Tx;
    ids: IdGenerator;
    companyId: string;
    preview: NonNullable<PackageCommitScope['preview']>;
  },
  created: number,
  at: string,
) {
  const { tx, ids, companyId, preview } = context;
  const counts = packageCommitCounts(preview.row_count, created);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'import_preview',
    entityId: preview.id,
    action: 'import.committed',
    after: { entity: 'packages', ...counts },
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'import_preview',
    aggregateId: preview.id,
    eventType: 'ImportCommitted',
    payload: {
      preview_id: preview.id,
      business_id: preview.business_id,
      entity: 'packages',
      ...counts,
      committed_at: at,
    },
  });
  await tx.execute(sql`UPDATE import_previews SET status='committed',committed_at=${at},created_count=${created}
            WHERE company_id=${companyId} AND id=${preview.id} AND entity='packages' AND status='commit_requested'`);
}

/** يحوّل رفض القيود بعد التراجع لرمز آمن ويترك أعطال البنية لإعادة المحاولة. */
function mapSqlError(error: unknown): never {
  // SQL constraint failures roll back the entire transaction. Only the explicit
  // external_ref conflict target in INSERT can ever turn a row into a skip.
  let cause = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
    const details = cause as Error & { code?: string; cause?: unknown };
    if (details.code !== undefined && ['23503', '23505', '23514'].includes(details.code))
      throw new PackageCommitError('IMPORT_COMMIT_FAILED');
    cause = details.cause;
  }
  throw error;
}
