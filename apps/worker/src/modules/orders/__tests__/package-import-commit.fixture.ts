import { sql } from 'drizzle-orm';
import { packageWorkbook, type PackagePreviewFixture } from './package-preview.fixture.ts';

export async function overlappingBusinesses(
  f: PackagePreviewFixture,
  membership: string,
  prefix: string,
) {
  const { id: a } = await f.requested(await packageWorkbook(2, 1, prefix));
  await f.worker.execute(f.company, a);
  const business = f.ids.newId();
  const service = f.ids.newId();
  await f.owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES(${f.company},${business},'salon','Synthetic competing business')`;
  await f.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${service},${business},'Service 0','9.000','FOLLOW_PLAN')`;
  const b = f.ids.newId();
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,status,row_count,error_count,rows,errors)
    SELECT company_id,${b},${business},entity,file_id,created_by,created_at,expires_at,'pending',0,0,'[]','[]'
    FROM import_previews WHERE id=${a}`;
  await f.owner`UPDATE import_previews target SET status='ready',row_count=source.row_count,error_count=source.error_count,
    skipped_count=source.skipped_count,source_rows=source.source_rows,skipped_rows=source.skipped_rows,
    rows=(SELECT jsonb_agg(jsonb_set(value,'{components,0,service_id}',to_jsonb(${service}::text)) ORDER BY ordinality DESC)
      FROM jsonb_array_elements(source.rows) WITH ORDINALITY),errors=source.errors
    FROM import_previews source WHERE target.id=${b} AND source.id=${a}`;
  for (const id of [a, b])
    await f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',commit_membership_id=${membership} WHERE id=${id}`),
    );
  return { a, b };
}
