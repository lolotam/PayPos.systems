import { sql } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import { packageImportRecoveryTransactions } from '../persistence/package-import-recovery.transactions.ts';
import { RecoverPackageImports } from '../use-cases/recover-package-imports/recover-package-imports.ts';
import { packagePreviewFixture, packageWorkbook } from './package-preview.fixture.ts';

// سقف قياس 47-2b الكامل، وليس ميزانية إنتاج.
export const COMMIT_TIMEOUT_MS = 30 * 60 * 1000;
// ساعة الـ fixture ثابتة على 2026-11-05T12:00:00Z؛ نافذة العشر دقائق تنتهي عند 11:50:00Z بالضبط.
export const STALE = '2026-11-05T11:50:00Z';

/** يجهز قاعدة اختبار ومسح استرداد وطالب تثبيت حقيقيين يتشاركهما spec المسح وspec القفل. */
export async function packageImportRecoveryFixture() {
  const f = await packagePreviewFixture();
  const membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;

  return {
    f,
    sweep: () =>
      new RecoverPackageImports(
        packageImportRecoveryTransactions(f.database, { timeoutMs: 5_000 }),
        f.clock,
      ),
    committer: () =>
      new CommitPackageImport(
        packageImportCommitTransactions(f.database, f.ids, { timeoutMs: COMMIT_TIMEOUT_MS }),
        f.clock,
      ),
    /** يرفع معاينة مقبولة إلى طلب تثبيت بلحظة قبول محددة. */
    staleRequest: async (prefix: string, requestedAt: string): Promise<string> => {
      const { id } = await f.requested(await packageWorkbook(1, 2, prefix));
      await f.worker.execute(f.company, id);
      await f.db.withTenant(f.company, async (tx) => {
        await tx.execute(
          sql`UPDATE import_previews SET status='commit_requested',requested_at=${requestedAt},commit_membership_id=${membership} WHERE id=${id}`,
        );
      });
      return id;
    },
    /**
     * يستنسخ صف import_previews مرات مع حمة الإثبات وحالته ولحظة قبوله.
     * إثبات التقسيم (source_rows/skipped_rows) يبقى فارغًا لأن عقد قاعدة البيانات يمنع إدراج معاينة تحمله:
     * هو يكتبه انتقال pending→ready وحده، والمسح لا يقرأ هذه الأعمدة.
     * لحظة القبول تُكتب صراحةً لأن عقد قاعدة البيانات يمنع تعديلها بعد انتقال الصف إلى commit_requested.
     */
    clone: async (id: string, times: number, requestedAt: string): Promise<void> => {
      await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
        status,requested_at,row_count,error_count,skipped_count,rows,errors)
        SELECT company_id,gen_random_uuid(),business_id,entity,file_id,created_by,created_at,expires_at,
          status,${requestedAt},row_count,error_count,skipped_count,rows,errors
        FROM import_previews CROSS JOIN generate_series(1,${times}) WHERE id=${id}`;
    },
  };
}

export type PackageImportRecoveryFixture = Awaited<ReturnType<typeof packageImportRecoveryFixture>>;
