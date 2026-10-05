import {
  appendOutboxEvent,
  runIdempotent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { documentFileFacts } from '../../files/index.ts';
import {
  lockEmployeeManagementAccess,
  readEmployeeManagementAccess,
} from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';

import {
  EmployeeImportError,
  type EmployeeImportCandidate,
  type EmployeeImportFileFacts,
  type EmployeeImportRowError,
} from '../domain/employee-import.ts';
import type {
  EmployeeImportTransactions,
  ImportBranch,
  ImportCommitScope,
  ImportPreviewScope,
  SaveImportPreviewInput,
  StoredImportPreview,
} from '../ports/employee-import.port.ts';

async function authorize(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  lock: boolean,
): Promise<boolean> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  if (!tree?.businesses.some((business) => business.id === businessId))
    throw new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND');
  const decision = lock
    ? await lockEmployeeManagementAccess(tx, companyId, userId, businessId)
    : await readEmployeeManagementAccess(tx, companyId, userId, businessId);
  if (!decision.manage) return false;
  if (!decision.featureEnabled) throw new EmployeeImportError('FEATURE_DISABLED');
  return true;
}

async function branches(tx: Tx, businessId: string): Promise<readonly ImportBranch[]> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business = tree?.businesses.find((candidate) => candidate.id === businessId);
  return (
    business?.branches.map((branch) => ({
      id: branch.id,
      name_en: branch.name_en,
      name_ar: branch.name_ar,
    })) ?? []
  );
}

function previewScope(tx: Tx, companyId: string, userId: string): ImportPreviewScope {
  return {
    authorize: (businessId) => authorize(tx, companyId, userId, businessId, false),
    fileFacts: (fileId): Promise<EmployeeImportFileFacts | null> =>
      documentFileFacts(tx, companyId, fileId) as Promise<EmployeeImportFileFacts | null>,
    branches: (businessId) => branches(tx, businessId),
    save: (input: SaveImportPreviewInput) => savePreview(tx, companyId, userId, input),
  };
}

function commitScope(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
): ImportCommitScope {
  return {
    authorize: (businessId) => authorize(tx, companyId, userId, businessId, true),
    load: (previewId) => loadPreview(tx, companyId, previewId),
    request: async (previewId, requestedAt) => {
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at=${requestedAt}
        WHERE company_id=${companyId} AND id=${previewId} AND status='ready'`);
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'EmployeeImportCommitRequested',
        payload: { preview_id: previewId },
      });
    },
  };
}
async function savePreview(
  tx: Tx,
  companyId: string,
  userId: string,
  input: SaveImportPreviewInput,
): Promise<void> {
  await tx.execute(sql`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${companyId},${input.id},${input.businessId},${input.entity},${input.fileId},${userId},
      ${input.createdAt},${input.expiresAt},${input.rowCount},${input.errors.length},
      ${JSON.stringify(input.rows)}::jsonb,${JSON.stringify(input.errors)}::jsonb)`);
}

type PreviewRow = {
  id: string;
  business_id: string;
  created_by: string;
  status: 'ready' | 'commit_requested' | 'committed' | 'failed';
  committed_at: Date | string | null;
  expires_at: Date | string;
  rows: readonly EmployeeImportCandidate[];
  errors: readonly EmployeeImportRowError[];
};

// الداتابيز قد تعيد timestamptz كـ Date أو نص حسب الإعداد؛ نوحّده إلى ISO.
function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<StoredImportPreview | null> {
  const [row] =
    await tx.execute<PreviewRow>(sql`SELECT id,business_id,created_by,status,committed_at,expires_at,rows,errors
    FROM import_previews WHERE company_id=${companyId} AND id=${previewId} AND entity='employees' FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    created_by: row.created_by,
    status: row.status,
    committed_at: row.committed_at === null ? null : asIso(row.committed_at),
    expires_at: asIso(row.expires_at),
    rows: row.rows,
    errors: row.errors,
  };
}

function cleanImportError(error: unknown): never {
  if (
    error instanceof EmployeeImportError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String(cause.code);
    if (code === '23503') throw new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND');
    if (['40001', '40P01', '55P03'].includes(code))
      throw new EmployeeImportError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('EMPLOYEE_IMPORT_PERSISTENCE_FAILED', { cause: error });
}

export function createEmployeeImportTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeImportTransactions {
  return {
    runPreview: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) => work(previewScope(tx, companyId, userId)),
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
    runCommit: async ({ companyId, userId, businessId, previewId, key, fingerprint }, work) => {
      try {
        return await database.withTenant(
          companyId,
          async (tx) => {
            const scope = commitScope(tx, companyId, userId, ids);
            if (!(await scope.authorize(businessId))) throw new EmployeeImportError('FORBIDDEN');
            const preview = await scope.load(previewId);
            if (
              preview === null ||
              preview.business_id !== businessId ||
              preview.created_by !== userId
            )
              throw new EmployeeImportError('IMPORT_PREVIEW_NOT_FOUND');
            const result = await runIdempotent(
              tx,
              { scope: 'COMPANY', operation: 'import-employees', key, fingerprint },
              async () => {
                const body = await work({
                  ...scope,
                  load: async (id) => (id === previewId ? preview : scope.load(id)),
                });
                return { status: 202, body };
              },
            );
            return result.body as { preview_id: string };
          },
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
  };
}
