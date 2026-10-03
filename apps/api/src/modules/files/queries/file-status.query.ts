import type { TenantWrappers } from '@pospay/db';
import { fileStatus, type FileStatus } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import type { RequestAuthorizer } from '../../../shared/request-authorizer.ts';

export class FileStatusQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly authorization: RequestAuthorizer,
  ) {}
  async execute(actor: { companyId: string; userId: string }, id: string): Promise<FileStatus> {
    // شاشة متابعة تأكيد الرفع تستهلك هذه القراءة دون روابط أو محتوى الوثيقة.
    const [row] = await this.db.withTenant(
      actor.companyId,
      (tx) =>
        tx.execute<{
          id: string;
          status: string;
          content_type: string;
          size_bytes: string;
          storage_key: string | null;
          rejection_code: string | null;
          business_id: string;
          branch_id: string | null;
          created_by: string;
          required_permission: string;
        }>(sql`SELECT id, status, content_type, size_bytes, storage_key, rejection_code,
      business_id, branch_id, created_by, required_permission FROM file_objects
      WHERE company_id = ${actor.companyId} AND id = ${id} AND purge_started_at IS NULL`),
      { userId: actor.userId },
    );
    if (row === undefined) throw new ApiError('FILE_NOT_FOUND');
    const permission =
      row.created_by === actor.userId ? 'manage:files:business' : row.required_permission;
    const authorized = await this.authorization.execute({
      userId: actor.userId,
      requestedCompany: actor.companyId,
      permission,
      businessParam: row.business_id,
      ...(row.branch_id === null ? {} : { branchParam: row.branch_id }),
    });
    if (authorized === null) throw new ApiError('FILE_NOT_FOUND');
    return fileStatus.parse({
      id: row.id,
      status: row.status,
      content_type: row.content_type,
      size_bytes: Number(row.size_bytes),
      ...(row.status === 'READY' ? { storage_key: row.storage_key } : {}),
      ...(row.rejection_code === null ? {} : { rejection_code: row.rejection_code }),
    });
  }
}
