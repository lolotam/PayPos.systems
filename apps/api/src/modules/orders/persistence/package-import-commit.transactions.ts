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
import { readPackageImportCommitAccess } from '../../identity/index.ts';
import {
  PackageImportCommitError,
  requireOwnedPackageImportPreview,
  type StoredPackageImportCommitPreview,
} from '../domain/package-import-commit.ts';
import type {
  PackageImportCommitScope,
  PackageImportCommitTransactions,
} from '../ports/package-import-commit.port.ts';

type CommitRow = {
  id: string;
  business_id: string;
  created_by: string;
  status: StoredPackageImportCommitPreview['status'];
  expires_at: Date | string;
  error_count: number;
  has_commit_rows: boolean;
};

// الداتابيز قد تعيد timestamptz كـ Date أو نص حسب الإعداد؛ نوحّده إلى ISO.
const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

// القراءة المقفلة FOR UPDATE تنتظر معاملة العامل المالية التي تمسك الصف طوال مدتها (حتى عشر دقائق)، والقراءة
// بلا قفل لا تنتظر؛ الفرق مقصود في runCommit.
async function queryPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
  clause: ReturnType<typeof sql>,
): Promise<StoredPackageImportCommitPreview | null> {
  const [row] =
    await tx.execute<CommitRow>(sql`SELECT id,business_id,created_by,status,expires_at,error_count,
      (source_rows IS NOT NULL AND skipped_rows IS NOT NULL) AS has_commit_rows
    FROM import_previews
    WHERE company_id=${companyId} AND id=${previewId} AND entity='packages' ${clause}`);
  return row === undefined ? null : { ...row, expires_at: asIso(row.expires_at) };
}

const peekPreview = (tx: Tx, companyId: string, previewId: string) =>
  queryPreview(tx, companyId, previewId, sql``);

const lockPreview = (tx: Tx, companyId: string, previewId: string) =>
  queryPreview(tx, companyId, previewId, sql`FOR UPDATE`);

// المعاينة المقبولة سابقاً (commit_requested أو committed) لا يلزمها قفل: قرارها تكرار بلا كتابة، والعامل قد يمسك
// صفها لدقائق، فلا نحجز عليه مفتاح الشركة وقفلها ولا اتصالاً من المجمّع. غير المقبولة تُقفل ثم تُعاد قراءتها بحالتها الحية.
async function readForDecision(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<StoredPackageImportCommitPreview | null> {
  const peek = await peekPreview(tx, companyId, previewId);
  if (peek?.status === 'commit_requested' || peek?.status === 'committed') return peek;
  return peek === null ? null : lockPreview(tx, companyId, previewId);
}

// نطاق القبول: تحويل الحالة وحدثها في المعاملة نفسها، فطلب ضائع وحدث ضائع لا يتفرقان.
function commitScope(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  locked: StoredPackageImportCommitPreview,
  membershipId: string,
): PackageImportCommitScope {
  return {
    load: async (previewId) =>
      previewId === locked.id ? locked : lockPreview(tx, companyId, previewId),
    request: async (previewId, requestedAt) => {
      await tx.execute(sql`UPDATE import_previews
        SET status='commit_requested',requested_at=${requestedAt},commit_membership_id=${membershipId}
        WHERE company_id=${companyId} AND id=${previewId} AND entity='packages' AND status='ready'`);
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'PackageImportCommitRequested',
        payload: { preview_id: previewId },
      });
    },
  };
}

// الرفض المسمّى يعبر كما هو؛ التعارض العابر يصبح إعادة محاولة مسمّاة، وغيره يبقى خطأ بنية تحتية.
function cleanCommitError(error: unknown): never {
  if (
    error instanceof PackageImportCommitError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String(cause.code);
    if (['40001', '40P01', '55P03'].includes(code))
      throw new PackageImportCommitError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('PACKAGE_IMPORT_COMMIT_PERSISTENCE_FAILED', { cause: error });
}

/**
 * يبني معاملة قبول تثبيت استيراد الباقات: معاملة واحدة تثبت الإذن الحي وتختار عضوية القبول، ثم تقفل
 * المعاينة وتثبت ملكيتها قبل مطالبة المفتاح، ثم تكتب الطلب والحدث وردّه المخزّن معاً (FR-060).
 *
 * @param database بوابة المستأجر
 * @param ids مولّد معرّف حدث القبول
 * @returns معاملة القبول
 */
export function createPackageImportCommitTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): PackageImportCommitTransactions {
  return {
    runCommit: async (actor, work) => {
      try {
        return await database.withTenant(
          actor.companyId,
          async (tx) => {
            const access = await readPackageImportCommitAccess(tx, actor);
            if (typeof access === 'string') throw new PackageImportCommitError(access);
            const locked = await readForDecision(tx, actor.companyId, actor.previewId);
            requireOwnedPackageImportPreview(locked, actor);
            const scope = commitScope(tx, actor.companyId, ids, locked, access.membershipId);
            const result = await runIdempotent(
              tx,
              {
                scope: 'COMPANY',
                operation: 'import-packages',
                key: actor.key,
                fingerprint: actor.fingerprint,
              },
              async () => ({ status: 202, body: await work(scope) }),
            );
            return result.body as { preview_id: string };
          },
          { userId: actor.userId },
        );
      } catch (error) {
        cleanCommitError(error);
      }
    },
  };
}
