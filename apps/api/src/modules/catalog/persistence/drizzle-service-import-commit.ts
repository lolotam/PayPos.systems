import {
  appendOutboxEvent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ServiceImportError } from '../domain/errors.ts';
import type { ServiceImportRowIssue } from '../domain/service-import-row.ts';
import type {
  ServiceImportCommitScope,
  ServiceImportTransactions,
  StoredServiceImportCommitPreview,
} from '../ports/service-import.port.ts';

type CommitRow = {
  id: string;
  business_id: string;
  created_by: string;
  status: string;
  expires_at: Date | string;
  error_count: number;
  errors: unknown;
};

// الداتابيز قد تعيد timestamptz كـ Date أو نص حسب الإعداد؛ نوحّده إلى ISO.
function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toStored(row: CommitRow): StoredServiceImportCommitPreview {
  return {
    id: row.id,
    business_id: row.business_id,
    created_by: row.created_by,
    status: row.status as StoredServiceImportCommitPreview['status'],
    expires_at: asIso(row.expires_at),
    error_count: row.error_count,
    errors: Array.isArray(row.errors) ? (row.errors as readonly ServiceImportRowIssue[]) : [],
  };
}

/**
 * عبارة قفل المعاينة: المفتاح الأساسي (company_id, id) هو الطريق، وحالة الكيان محصورة بالعينة.
 *
 * @param companyId الشركة المستهدفة
 * @param previewId معرّف المعاينة
 * @returns عبارة القراءة المقفلة
 */
export function serviceImportCommitPreviewStatement(companyId: string, previewId: string) {
  return sql`SELECT id,business_id,created_by,status,expires_at,error_count,errors
    FROM import_previews
    WHERE company_id=${companyId} AND id=${previewId} AND entity='services' FOR UPDATE`;
}

async function readPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<StoredServiceImportCommitPreview | null> {
  const [row] = await tx.execute<CommitRow>(
    serviceImportCommitPreviewStatement(companyId, previewId),
  );
  return row === undefined ? null : toStored(row);
}

/**
 * نطاق القبول على المعاملة نفسها: قراءة المعاينة المقفلة، ونقلها إلى الطلب المقبول مع حدثه.
 * الحدث يُكتب في نفس المعاملة التي تغيّر حالة المعاينة، فطلب ضائع وحدث ضائع لا يتفرقان.
 */
function commitScope(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  locked: StoredServiceImportCommitPreview,
): ServiceImportCommitScope {
  return {
    load: async (previewId) =>
      previewId === locked.id ? locked : readPreview(tx, companyId, previewId),
    request: async (previewId, requestedAt) => {
      await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at=${requestedAt}
        WHERE company_id=${companyId} AND id=${previewId} AND entity='services' AND status='ready'`);
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'ServiceImportCommitRequested',
        payload: { preview_id: previewId },
      });
    },
  };
}

/**
 * يحوّل خطأ قاعدة البيانات إلى refusal مسمّى أو خطأ infrastructure مكتوب؛ رفض الـ API يبني
 * الكود المسمّى، والخطأ الخام لا يعبر الشبكة بحرفياته.
 *
 * @param error الخطأ الملتقط من المعاملة
 * @returns لا شيء؛ الرمي هو النتيجة
 */
export function cleanImportError(error: unknown): never {
  if (
    error instanceof ServiceImportError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String(cause.code);
    if (['40001', '40P01', '55P03'].includes(code))
      throw new ServiceImportError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('SERVICE_IMPORT_PERSISTENCE_FAILED', { cause: error });
}

/**
 * يبني معاملات قبول تثبيت استيراد الخدمات: معاملة واحدة تقفل المعاينة وتثبت ملكيتها قبل
 * مطالبة المفتاح، ثم تكتب الطلب والحدث وردّه المخزّن معاً (FR-008).
 *
 * @param database بوابة المستأجر
 * @param ids      مولّد معرّفات حدث القبول
 * @returns معاملة القبول
 */
export function createServiceImportCommitTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): Pick<ServiceImportTransactions, 'runCommit'> {
  return {
    runCommit: async (actor, work) => {
      try {
        return await database.withTenant(
          actor.companyId,
          async (tx) => {
            const locked = await readPreview(tx, actor.companyId, actor.previewId);
            if (
              locked === null ||
              locked.business_id.toLowerCase() !== actor.businessId.toLowerCase() ||
              locked.created_by.toLowerCase() !== actor.userId.toLowerCase()
            )
              throw new ServiceImportError('IMPORT_PREVIEW_NOT_FOUND');
            const scope = commitScope(tx, actor.companyId, ids, locked);
            const result = await runIdempotent(
              tx,
              {
                scope: 'COMPANY',
                operation: 'import-services',
                key: actor.key,
                fingerprint: actor.fingerprint,
              },
              async () => {
                const body = await work(scope);
                return { status: 202, body };
              },
            );
            return result.body as { preview_id: string };
          },
          { userId: actor.userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
  };
}
