import { appendOutboxEvent, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { documentFileFacts } from '../../files/index.ts';
import { readPackageImportAccess } from '../../identity/index.ts';
import {
  PackageImportRequestError,
  type PackageImportActor,
} from '../domain/package-import-request.ts';
import type {
  PackageImportRequestScope,
  PackageImportRequestTransactions,
} from '../ports/package-import-request.port.ts';

function requestScope(
  tx: Tx,
  actor: PackageImportActor,
  ids: IdGenerator,
): PackageImportRequestScope {
  return {
    authorize: async () => {
      const refusal = await readPackageImportAccess(tx, actor);
      if (refusal !== null) throw new PackageImportRequestError(refusal);
    },
    fileFacts: (fileId) => documentFileFacts(tx, actor.companyId, fileId),
    createPending: async (input) => {
      await tx.execute(sql`INSERT INTO import_previews
        (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,skipped_count,rows,errors)
        VALUES (${actor.companyId},${input.id},${actor.businessId},'packages',${input.fileId},${actor.userId},
          ${input.createdAt},${input.expiresAt},'pending',0,0,0,'[]'::jsonb,'[]'::jsonb)`);
    },
    publishRequested: (previewId) =>
      appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'PackageImportPreviewRequested',
        payload: { preview_id: previewId },
      }),
  };
}

export function createPackageImportRequestTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): PackageImportRequestTransactions {
  return {
    run: (actor, work) =>
      database.withTenant(actor.companyId, (tx) => work(requestScope(tx, actor, ids)), {
        userId: actor.userId,
      }),
  };
}
