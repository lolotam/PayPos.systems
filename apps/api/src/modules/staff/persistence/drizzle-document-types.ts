import {
  appendAuditLog,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { DocumentError, type DocumentTypeRecord } from '../domain/document-types.ts';
import type {
  DocumentTypeAction,
  DocumentTypeScope,
  DocumentTypeTransactions,
} from '../ports/document-types.port.ts';
import { documentAccess, documentAccessLock } from './document-access.adapter.ts';
import { documentFailure } from './document-failures.ts';

const COLUMNS = sql`id, code, name_en, name_ar, alert_days, requires_expiry, active, revision`;

async function authorize(tx: Tx, companyId: string, userId: string) {
  if (!(await documentAccessLock(tx, companyId))) throw new DocumentError('FORBIDDEN');
  const access = await documentAccess(tx, companyId, userId, null);
  if (!access.manageTypes) throw new DocumentError('FORBIDDEN');
  if (!access.featureEnabled) throw new DocumentError('FEATURE_DISABLED');
}

async function save(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  change: {
    action: DocumentTypeAction;
    before: DocumentTypeRecord | null;
    after: DocumentTypeRecord;
  },
) {
  const { action, before, after: t } = change;
  if (before === null)
    await tx.execute(sql`INSERT INTO document_types(company_id, id, code, name_en, name_ar, alert_days, requires_expiry, active, revision)
      VALUES (${companyId}, ${t.id}, ${t.code}, ${t.name_en}, ${t.name_ar}, ${t.alert_days}, ${t.requires_expiry}, ${t.active}, ${t.revision})`);
  else
    await tx.execute(sql`UPDATE document_types SET name_en=${t.name_en}, name_ar=${t.name_ar}, alert_days=${t.alert_days},
      requires_expiry=${t.requires_expiry}, active=${t.active}, revision=${t.revision}
      WHERE company_id=${companyId} AND id=${t.id} AND revision=${before.revision}`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'document_type',
    entityId: t.id,
    action: `document_type.${action}`,
    before,
    after: t,
  });
}

function scope(tx: Tx, companyId: string, ids: IdGenerator): DocumentTypeScope {
  return {
    count: async () => {
      const [row] = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM document_types WHERE company_id=${companyId}`,
      );
      return row?.count ?? 0;
    },
    lock: async (typeId) => {
      const [row] = await tx.execute<DocumentTypeRecord>(
        sql`SELECT ${COLUMNS} FROM document_types WHERE company_id=${companyId} AND id=${typeId} FOR UPDATE`,
      );
      if (row === undefined) throw new DocumentError('NOT_FOUND');
      return row;
    },
    save: (action, before, after) => save(tx, companyId, ids, { action, before, after }),
  };
}

export function createDocumentTypeTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): DocumentTypeTransactions {
  return {
    run: async (context, operation, status, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => {
            await authorize(tx, context.companyId, context.userId);
            const result = await runIdempotent(
              tx,
              { scope: 'COMPANY', operation, key: context.key, fingerprint: context.fingerprint },
              async () => ({ status, body: await work(scope(tx, context.companyId, ids)) }),
            );
            return result.body as DocumentTypeRecord;
          },
          { userId: context.userId },
        );
      } catch (error) {
        throw documentFailure(error, operation);
      }
    },
  };
}
