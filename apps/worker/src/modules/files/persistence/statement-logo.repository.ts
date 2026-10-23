import { appendAuditLog, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { StatementLogoFile, StatementLogoRequest } from '../domain/statement-logo.ts';
import type { IdGenerator, StatementLogoStore } from '../ports/statement-logo.port.ts';

type LogoRow = {
  storage_key: string;
  content_type: 'image/png' | 'image/jpeg';
};

export function statementLogoRepository(db: TenantWrappers, ids: IdGenerator): StatementLogoStore {
  return {
    record: (companyId: string, request: StatementLogoRequest, at: Date) =>
      db.withTenant(
        companyId,
        async (tx) => {
          // الملف هو اللي اتسجل على طلب الرندر، مش الشعار المربوط دلوقتي: قرار الرندر ما بيتبدّلش بعد ما يتعمل.
          const [row] = await tx.execute<LogoRow>(sql`
            SELECT storage_key, content_type FROM file_objects
            WHERE company_id = ${companyId} AND id = ${request.fileId}
              AND business_id = ${request.businessId} AND owner_module = 'settings'
              AND owner_entity_id = ${request.businessId} AND status = 'READY'
              AND purge_started_at IS NULL AND purged_at IS NULL
              AND content_type IN ('image/png','image/jpeg')`);
          if (row === undefined) return null;
          const access = await tx.execute<{ id: string }>(sql`
            INSERT INTO file_access_audit (company_id, id, file_id, actor_user_id, accessed_at, outcome)
            VALUES (${companyId}, ${request.renderId}, ${request.fileId}, ${request.requesterUserId},
              ${at.toISOString()}::timestamptz, 'ALLOW')
            ON CONFLICT (company_id, id) DO NOTHING RETURNING id`);
          if (access.length === 1) {
            await appendAuditLog(tx, ids.newId(), {
              entity: 'file',
              entityId: request.fileId,
              action: 'access',
              after: { outcome: 'ALLOW' },
            });
          }
          return { storageKey: row.storage_key, contentType: row.content_type };
        },
        { userId: request.requesterUserId },
      ),
  };
}
