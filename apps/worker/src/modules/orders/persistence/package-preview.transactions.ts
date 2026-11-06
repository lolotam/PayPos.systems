import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { documentFileFacts } from '../../files/index.ts';
import { readPackageImportServices } from '../../catalog/index.ts';
import { readPackageImportCustomers } from '../../customers/index.ts';
import type {
  PackagePreviewTransactions,
  PendingPackagePreview,
  PackagePreviewScope,
} from '../ports/package-preview.port.ts';

type PreviewRecord = {
  id: string;
  business_id: string;
  created_by: string;
  file_id: string;
  expires_at: Date | string;
};

async function pending(
  tx: Tx,
  companyId: string,
  previewId: string,
  lock: boolean,
): Promise<PendingPackagePreview | null> {
  const [row] =
    await tx.execute<PreviewRecord>(sql`SELECT id,business_id,created_by,file_id,expires_at
    FROM import_previews WHERE company_id=${companyId} AND id=${previewId} AND entity='packages'
    AND status='pending' ${lock ? sql`FOR UPDATE` : sql``}`);
  if (row === undefined) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.created_by,
    fileId: row.file_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    file: await documentFileFacts(tx, companyId, row.file_id, lock ? 'share' : undefined),
  };
}

function scope(
  tx: Tx,
  companyId: string,
  preview: PendingPackagePreview | null,
): PackagePreviewScope {
  return {
    preview,
    services: () =>
      preview === null
        ? Promise.resolve([])
        : readPackageImportServices(tx, companyId, preview.businessId),
    existingRefs: async (refs) => {
      if (refs.length === 0) return [];
      const rows = await tx.execute<{
        external_ref: string;
      }>(sql`SELECT external_ref FROM package_entitlements
        WHERE company_id=${companyId} AND external_ref=ANY(ARRAY[${sql.join(
          refs.map((ref) => sql`${ref}`),
          sql`, `,
        )}]::text[])`);
      return rows.map((row) => row.external_ref);
    },
    findByPhones: (phones) => readPackageImportCustomers(tx, companyId, phones),
    ready: async (sourceRows, result) => {
      if (preview === null) return;
      await tx.execute(sql`UPDATE import_previews SET status='ready',row_count=${sourceRows.length},
        error_count=${result.errors.length},skipped_count=${result.skipped.length},
        source_rows=${JSON.stringify(sourceRows)}::jsonb,
        skipped_rows=${JSON.stringify(result.skipped.map(({ row }) => row))}::jsonb,
        rows=${JSON.stringify(result.rows)}::jsonb,errors=${JSON.stringify(result.errors)}::jsonb
        WHERE company_id=${companyId} AND id=${preview.id} AND entity='packages' AND status='pending'`);
    },
  };
}

export function packagePreviewTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): PackagePreviewTransactions {
  return {
    load: (companyId, previewId) =>
      database.withTenant(companyId, (tx) => pending(tx, companyId, previewId, false)),
    finish: (companyId, previewId, work) =>
      database.withTenant(companyId, async (tx) => {
        const preview = await pending(tx, companyId, previewId, true);
        if (preview !== null)
          await tx.execute(sql`SELECT set_config('app.user_id',${preview.userId},true)`);
        return work(scope(tx, companyId, preview));
      }),
    fail: async (companyId, previewId, code) => {
      try {
        await database.withTenant(companyId, async (tx) => {
          await tx.execute(sql`UPDATE import_previews SET status='failed',error_code=${code}
            WHERE company_id=${companyId} AND id=${previewId} AND entity='packages' AND status='pending'`);
        });
      } catch {
        throw new Error('PACKAGE_PREVIEW_RETRY');
      }
    },
  };
}
