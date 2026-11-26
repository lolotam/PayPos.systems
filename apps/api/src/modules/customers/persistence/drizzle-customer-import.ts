import {
  appendAuditLog,
  appendOutboxEvent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { readSheet } from '../../../shared/import/import-sheet.ts';
import { createObjectBytesReader } from '../../../shared/import/object-bytes-reader.ts';
import {
  ImportWorkbookError,
  readWorkbookSheet,
} from '../../../shared/import/xlsx-sheet-reader.ts';
import {
  CUSTOMER_IMPORT_COLUMNS,
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_MAX_COLUMNS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CustomerImportError,
  type CustomerImportCommitPreview,
  type CustomerImportFileFacts,
} from '../domain/customer-import.ts';
import type {
  CustomerImportCommitScope,
  CustomerImportFilesBinding,
  CustomerImportScope,
  CustomerImportScopeInput,
  CustomerImportSheetReader,
  CustomerImportTransactions,
  SaveCustomerImportPreviewInput,
} from '../ports/customer-import.port.ts';
import { readCustomerImportScope } from './workspace-names.adapter.ts';

export const CUSTOMER_IMPORT_READER_BOUNDS = {
  maxBytes: CUSTOMER_IMPORT_MAX_BYTES,
  maxDataRows: CUSTOMER_IMPORT_MAX_ROWS,
  maxColumns: CUSTOMER_IMPORT_MAX_COLUMNS,
  maxWorksheets: 2,
};

export function createCustomerImportSheetReader(): CustomerImportSheetReader {
  return {
    read: async (bytes) => {
      try {
        const workbook = await readWorkbookSheet(bytes, CUSTOMER_IMPORT_READER_BOUNDS);
        const sheet = readSheet(workbook.matrix, CUSTOMER_IMPORT_COLUMNS, CUSTOMER_IMPORT_MAX_ROWS);
        if (sheet === 'IMPORT_HEADER_INVALID' || sheet === 'IMPORT_ROW_LIMIT_EXCEEDED')
          throw new CustomerImportError(sheet);
        return sheet.rows;
      } catch (error) {
        if (error instanceof CustomerImportError) throw error;
        if (error instanceof ImportWorkbookError) {
          throw new CustomerImportError(
            error.code === 'IMPORT_ROW_LIMIT_EXCEEDED'
              ? 'IMPORT_ROW_LIMIT_EXCEEDED'
              : 'IMPORT_FILE_CONTENT_INVALID',
          );
        }
        throw error;
      }
    },
  };
}

export function bindCustomerImportFiles(
  storage: { read(key: string, maxBytes: number): Promise<Uint8Array> } | null,
  facts:
    | ((tx: never, companyId: string, fileId: string) => Promise<CustomerImportFileFacts | null>)
    | null,
): CustomerImportFilesBinding {
  return {
    fileFacts: {
      facts: (tx, companyId, fileId) =>
        facts === null ? Promise.resolve(null) : facts(tx as never, companyId, fileId),
    },
    bytes:
      storage === null
        ? null
        : createObjectBytesReader(storage, (code) => new CustomerImportError(code)),
  };
}

export const customerImportScopeReads = {
  business: async (tx: Tx, companyId: string, kind: 'business' | 'branch', id: string) =>
    (await readCustomerImportScope(tx, companyId, { kind, id }))?.businessId ?? null,
};

async function resolveScope(tx: Tx, companyId: string, scope: CustomerImportScope) {
  const resolved = await readCustomerImportScope(tx, companyId, scope);
  if (resolved === null) throw new CustomerImportError('NOT_FOUND');
  return resolved;
}

async function readExistingPhones(tx: Tx, companyId: string, phones: readonly string[]) {
  if (phones.length === 0) return new Set<string>();
  const rows = await tx.execute<{ phone: string }>(sql`SELECT phone FROM customers
    WHERE company_id = ${companyId}
      AND phone = ANY(ARRAY[${sql.join(
        phones.map((phone) => sql`${phone}`),
        sql`, `,
      )}]::text[])`);
  return new Set(rows.map((row) => row.phone));
}

async function savePreview(
  tx: Tx,
  companyId: string,
  userId: string,
  input: SaveCustomerImportPreviewInput,
): Promise<void> {
  await tx.execute(sql`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${companyId},${input.id},${input.businessId},'customers',${input.fileId},${userId},
      ${input.createdAt},${input.expiresAt},${input.rowCount},${input.errors.length},
      ${JSON.stringify(input.rows)}::jsonb,${JSON.stringify(input.errors)}::jsonb)`);
}

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

async function readPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<CustomerImportCommitPreview | null> {
  const [row] = await tx.execute<Record<string, unknown>>(sql`
    SELECT id,business_id,created_by,status,expires_at,error_count FROM import_previews
    WHERE company_id=${companyId} AND id=${previewId} AND entity='customers' FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: String(row['id']),
    business_id: String(row['business_id']),
    created_by: String(row['created_by']),
    status: String(row['status']) as CustomerImportCommitPreview['status'],
    expires_at: asIso(row['expires_at'] as Date | string),
    error_count: Number(row['error_count']),
  };
}

/** يحوّل خطأ القاعدة إلى رفض مسمّى؛ الخطأ الخام لا يعبر ولا يكشف هاتفاً (CIM-06). */
export function cleanCustomerImportError(error: unknown): never {
  if (
    error instanceof CustomerImportError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (['40001', '40P01', '55P03'].includes(String(cause.code)))
      throw new CustomerImportError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('CUSTOMER_IMPORT_PERSISTENCE_FAILED');
}

async function withCleanTenant<T>(
  database: TenantWrappers,
  input: Pick<CustomerImportScopeInput, 'companyId' | 'userId'>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await database.withTenant(input.companyId, fn, { userId: input.userId });
  } catch (error) {
    cleanCustomerImportError(error);
  }
}

function buildCommitScope(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  businessId: string,
  locked: CustomerImportCommitPreview,
): CustomerImportCommitScope {
  return {
    businessId,
    load: async (previewId) =>
      previewId === locked.id ? locked : readPreview(tx, companyId, previewId),
    request: async (previewId, requestedAt) => {
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at=${requestedAt}
        WHERE company_id=${companyId} AND id=${previewId} AND entity='customers' AND status='ready'`);
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'CustomerImportCommitRequested',
        payload: { preview_id: previewId },
      });
    },
  };
}

export function createCustomerImportTransactions(
  database: TenantWrappers,
  files: CustomerImportFilesBinding,
  ids: IdGenerator,
): CustomerImportTransactions {
  return {
    runFacts: (input, work) =>
      withCleanTenant(database, input, async (tx) => {
        const resolved = await resolveScope(tx, input.companyId, input.scope);
        const facts =
          input.fileId === undefined
            ? null
            : await files.fileFacts.facts(tx, input.companyId, input.fileId);
        return work({ businessId: resolved.businessId, countryCode: resolved.countryCode, facts });
      }),
    runSave: (input, work) =>
      withCleanTenant(database, input, async (tx) => {
        const { businessId } = await resolveScope(tx, input.companyId, input.scope);
        return work({
          businessId,
          existingPhones: (phones) => readExistingPhones(tx, input.companyId, phones),
          save: (save) => savePreview(tx, input.companyId, input.userId, save),
          auditFileAccess: (fileId) =>
            appendAuditLog(tx, ids.newId(), {
              entity: 'file',
              entityId: fileId,
              action: 'import_previewed',
              after: { purpose: 'customers_import_preview' },
            }),
        });
      }),
    runCommit: (input, work) =>
      withCleanTenant(database, input, async (tx) => {
        const { businessId } = await resolveScope(tx, input.companyId, input.scope);
        const locked = await readPreview(tx, input.companyId, input.previewId);
        // المعاينة الغريبة أو لمنشئ آخر مجهولة قبل تسجيل الطلب في جدول الـ idempotency (CIM-08).
        if (
          locked === null ||
          locked.business_id.toLowerCase() !== businessId.toLowerCase() ||
          locked.created_by.toLowerCase() !== input.userId.toLowerCase()
        )
          throw new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND');
        const scope = buildCommitScope(tx, ids, input.companyId, businessId, locked);
        const result = await runIdempotent(
          tx,
          {
            scope: 'COMPANY',
            operation: 'import-customers',
            key: input.key,
            fingerprint: input.fingerprint,
          },
          async () => ({ status: 202, body: await work(scope) }),
        );
        return result.body as ReturnType<typeof work> extends Promise<infer R> ? R : never;
      }),
  };
}
