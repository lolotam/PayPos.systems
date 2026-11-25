import { sql } from 'drizzle-orm';
import { CommitPackageImportUseCase } from '../use-cases/commit-package-import/commit-package-import.usecase.ts';
import { createPackageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import type { PackagePreviewRequestFixture } from './package-preview-request.fixture.ts';

type Fixture = PackagePreviewRequestFixture;

/** يرفع معاينة pending ثم يجعلها ready بصف مقبول واحد ومتخطى واحد، كما يثبتها عامل المعاينة. */
export async function readyPreview(f: Fixture): Promise<string> {
  const { preview_id: id } = await f.useCase.execute(f.command(await f.upload()));
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`UPDATE import_previews SET status='ready',row_count=2,skipped_count=1,
      source_rows='[2,3]'::jsonb,skipped_rows='[3]'::jsonb,
      rows='[{"row":2,"customer_id":"safe","phone_last3":"678"}]'::jsonb WHERE id=${id}`);
  });
  return id;
}

/** المعاينة نفسها بعد ثبوت أخطاء صف واحد؛ تبقى ready لأن العامل يخزّن الأخطاء ولا يفشل. */
export async function readyPreviewWithErrors(f: Fixture): Promise<string> {
  const { preview_id: id } = await f.useCase.execute(f.command(await f.upload()));
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`UPDATE import_previews SET status='ready',row_count=1,error_count=1,skipped_count=0,
      source_rows='[2]'::jsonb,skipped_rows='[]'::jsonb,rows='[]'::jsonb,
      errors='[{"row":2,"column":"name_en","code":"IMPORT_NAME_INVALID"}]'::jsonb WHERE id=${id}`);
  });
  return id;
}

/** يبني حالة الاستخدام على ساعة محقونة، لاختبار الانتهاء دون تعديل صف المعاينة. */
export function commitUseCase(f: Fixture, now: () => Date, ids = f.ids) {
  return new CommitPackageImportUseCase(createPackageImportCommitTransactions(f.database, ids), {
    now,
  });
}

/** حالة صف المعاينة وأحداثه، لإثبات أن الرفض لم يكتب شيئاً. */
export async function commitState(f: Fixture, id: string) {
  const [preview] = await f.h.owner`SELECT status,requested_at,commit_membership_id
    FROM import_previews WHERE company_id=${f.companyId} AND id=${id}`;
  const events = await f.h.owner`SELECT event_type,payload FROM outbox
    WHERE company_id=${f.companyId} AND aggregate_id=${id} AND event_type='PackageImportCommitRequested'`;
  return { preview, events };
}

/** طلب HTTP حقيقي إلى مسار التثبيت بمفتاح التكرار المعطى. */
export function postCommit(f: Fixture, previewId: string, key: string | null) {
  return f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.businessId}/packages/import/commits`,
    headers: { ...f.headers, ...(key === null ? {} : { 'idempotency-key': key }) },
    payload: { preview_id: previewId },
  });
}
