import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  serviceImportRecoveryPage,
  serviceImportRecoveryTransactions,
} from '../persistence/service-import-recovery.transactions.ts';
import { RecoverServiceImports } from '../use-cases/recover-service-imports/recover-service-imports.ts';
import {
  normalizedRow,
  serviceImportCommitFixture,
  type ServiceImportCommitFixture,
} from './service-import-commit.fixture.ts';

// ساعة الـ fixture ثابتة على 2026-11-22T12:00:00Z؛ نافذة العشر دقائق تنتهي عند 11:50:00Z بالضبط.
export const STALE = '2026-11-22T11:50:00Z';
// نفس لحظة النافذة بعد ميلي ثانية واحدة: الطلب الأصغر سنًا من حد العشر دقائق.
export const YOUNG = '2026-11-22T11:50:00.001Z';

/** يحجز صف معاينة بقفل صف حقيقي على اتصال owner مستقل حتى يُستدعى الإفراج. */
function holdRow(f: ServiceImportCommitFixture, id: string) {
  let held!: () => void;
  const heldPromise = new Promise<void>((resolve) => {
    held = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = f.owner
    .begin(async (tx) => {
      await tx`SELECT id FROM import_previews WHERE company_id=${f.company} AND id=${id} FOR UPDATE`;
      held();
      await gate;
      throw new Error('holder rollback');
    })
    .catch(() => undefined);
  return { heldPromise, release: () => release(), settled: holding };
}

/** يقرأ خطة تنفيذ عبارة المسح داخل معاملة مرفوضة، فيبقى أثرها على بيانات الاختبار صفرًا. */
async function explain(f: ServiceImportCommitFixture, before: Date): Promise<string> {
  let plan = '';
  await expect(
    f.db.withTenant(f.company, async (tx) => {
      const rows = await tx.execute(sql`EXPLAIN ANALYZE ${serviceImportRecoveryPage(f.company, before)}`);
      plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      throw new Error('EXPLAIN_ROLLBACK');
    }),
  ).rejects.toThrow('EXPLAIN_ROLLBACK');
  return plan;
}

/** ينشئ معاينة بكيان آخر (موظف أو باقة) لنفس الشركة أو لمستأجر آخر. */
async function entityRequest(
  f: ServiceImportCommitFixture,
  entity: string,
  requestedAt: string,
  options: { companyId?: string; businessId?: string } = {},
): Promise<string> {
  const companyId = options.companyId ?? f.company;
  const [file] = await f.owner`SELECT id FROM file_objects WHERE company_id=${companyId} LIMIT 1`;
  const id = f.ids.newId();
  await f.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,requested_at,
      row_count,error_count,rows,errors)
    VALUES (${companyId},${id},${options.businessId ?? f.business},${entity},${file?.['id']},${f.userId},
      ${requestedAt},${new Date(new Date(requestedAt).getTime() + 86_400_000).toISOString()},
      'commit_requested',${requestedAt},0,0,'[]','[]')`;
  return id;
}

/**
 * يستنسخ صف import_previews مرات مع حمة الإثبات وحالته ولحظة قبوله.
 * أعمدة الإثبات تبقى فارغة لأن عقد قاعدة البيانات يمنع إدراج معاينة تحملها:
 * هو يكتبها انتقال pending→ready وحده، والمسح لا يقرأ هذه الأعمدة.
 */
async function clone(
  f: ServiceImportCommitFixture,
  id: string,
  times: number,
  requestedAt: string,
): Promise<void> {
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
    status,requested_at,row_count,error_count,rows,errors)
    SELECT company_id,gen_random_uuid(),business_id,entity,file_id,created_by,created_at,expires_at,
      status,${requestedAt},row_count,error_count,rows,errors
    FROM import_previews CROSS JOIN generate_series(1,${times}) WHERE id=${id}`;
}

/** يجهّز قاعدة اختبار حقيقية ومسح استرداد لطلبات تثبيت الخدمات العالقة. */
export async function serviceImportRecoveryFixture() {
  const f = await serviceImportCommitFixture();
  return {
    ...f,
    sweep: () =>
      new RecoverServiceImports(serviceImportRecoveryTransactions(f.db, { timeoutMs: 5_000 }), {
        now: () => f.clock.value,
      }),
    /** يرفع معاينة خدمات إلى طلب تثبيت مقبول بلحظة قبول محددة. */
    staleRequest: async (prefix: string, requestedAt: string): Promise<string> =>
      f.requested([normalizedRow(`${prefix}-0`)], { requestedAt: new Date(requestedAt) }),
    entityRequest: async (
      entity: string,
      requestedAt: string,
      options: { companyId?: string; businessId?: string } = {},
    ): Promise<string> => entityRequest(f, entity, requestedAt, options),
    clone: async (id: string, times: number, requestedAt: string): Promise<void> =>
      clone(f, id, times, requestedAt),
    holdRow: (id: string) => holdRow(f, id),
    explain: async (before: Date): Promise<string> => explain(f, before),
  };
}

export type ServiceImportRecoveryFixture = Awaited<
  ReturnType<typeof serviceImportRecoveryFixture>
>;

export { normalizedRow };
