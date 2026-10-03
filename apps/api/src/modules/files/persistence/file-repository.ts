import {
  appendAuditLog,
  appendOutboxEvent,
  type TenantWrappers,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { FileRepository, Actor } from '../ports/files.port.ts';
import { FileError, type FileRecord } from '../domain/file.ts';

export type FileRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  created_by: string;
  required_permission: string;
  staging_key: string;
  storage_key: string | null;
  content_type: string;
  size_bytes: string;
  status: FileRecord['status'];
};
// رسالة DB وcause قد تحملان المفتاح؛ الحد يعيد رمزاً آمناً فقط.
class FilePersistenceError extends Error {
  constructor() {
    super('FILE_PERSISTENCE_FAILED');
  }
}
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FilePersistenceError();
  }
}
function map(row: FileRow): FileRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    createdBy: row.created_by,
    requiredPermission: row.required_permission,
    stagingKey: row.staging_key,
    storageKey: row.storage_key,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
  };
}
export function createFileRepository(db: TenantWrappers, ids: IdGenerator): FileRepository {
  const run = <T>(actor: Actor, work: (tx: Tx) => Promise<T>): Promise<T> =>
    safely(() => db.withTenant(actor.companyId, work, { userId: actor.userId }));
  return {
    create: (actor, file) =>
      run(actor, async (tx) => {
        if (file.branchId !== null) {
          const branch = await tx.execute(
            sql`SELECT id FROM branches WHERE company_id = ${actor.companyId} AND business_id = ${file.businessId} AND id = ${file.branchId}`,
          );
          if (branch.length !== 1) throw new FileError('FORBIDDEN');
        }
        await tx.execute(sql`INSERT INTO file_objects (company_id, id, business_id, branch_id, owner_module,
        owner_entity_id, staging_key, content_type, size_bytes, required_permission, created_by, created_at)
        VALUES (${actor.companyId}, ${file.id}, ${file.businessId}, ${file.branchId}, ${file.ownerModule},
        ${file.ownerEntityId}, ${file.stagingKey}, ${file.contentType}, ${file.sizeBytes}, ${file.requiredPermission}, ${actor.userId}, ${file.createdAt.toISOString()})`);
        await appendOutboxEvent(tx, ids.newId(), {
          aggregateType: 'file',
          aggregateId: file.id,
          eventType: 'FileUploadRequested',
          payload: { fileId: file.id },
        });
      }),
    confirm: (actor, id, at) =>
      run(actor, async (tx) => {
        const rows =
          await tx.execute(sql`UPDATE file_objects SET confirmed_at = COALESCE(confirmed_at, ${at.toISOString()}::timestamptz)
        WHERE company_id = ${actor.companyId} AND id = ${id} AND created_by = ${actor.userId}
        AND purge_started_at IS NULL AND status != 'REJECTED' RETURNING id`);
        return rows.length === 1;
      }),
    find: (actor, id) => run(actor, (tx) => findRecord(tx, actor.companyId, 'id', id)),
    findByKey: (actor, key) =>
      run(actor, (tx) => findRecord(tx, actor.companyId, 'storage_key', key)),
    audit: (actor, id, outcome, at) =>
      run(actor, async (tx) => {
        await tx.execute(sql`INSERT INTO file_access_audit (company_id, id, file_id, actor_user_id, accessed_at, outcome)
        VALUES (${actor.companyId}, ${ids.newId()}, ${id}, ${actor.userId}, ${at.toISOString()}, ${outcome})`);
        await appendAuditLog(tx, ids.newId(), {
          entity: 'file',
          entityId: id,
          action: 'access',
          after: { outcome },
        });
      }),
  };
}

async function findRecord(
  tx: Tx,
  companyId: string,
  column: 'id' | 'storage_key',
  value: string,
): Promise<FileRecord | null> {
  const [row] =
    await tx.execute<FileRow>(sql`SELECT id, business_id, branch_id, created_by, required_permission,
    staging_key, storage_key, content_type, size_bytes, status FROM file_objects
    WHERE company_id = ${companyId} AND ${sql.identifier(column)} = ${value} AND purge_started_at IS NULL`);
  return row === undefined ? null : map(row);
}
