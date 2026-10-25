import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import {
  countSessionsSinceStatement,
  sessionsSinceStatement,
  type BootstrapRangeRead,
} from '../queries/day-sessions-since.query.ts';
import { daySessionsFixture, type DaySessionsFixture } from './day-sessions.fixture.ts';

// عدّاد التغطية يعدّ كل صف داخل النطاق، والـ planner ممكن يختار مسحاً تسلسلياً لما يكون الصفوف
// كتيرة جوه النطاق؛ الاختبار مكتوب زي ما هو، والمشي على فهرس service_sessions هو اللي بيتأكد منه.
let f: DaySessionsFixture;
beforeAll(async () => {
  f = await daySessionsFixture();
});
afterAll(async () => {
  await f?.close();
});

it('reads the bootstrap pages and the coverage count through a service_sessions index', async () => {
  const maxSessionId = f.ids.newId();
  await plantSessions();
  const range: BootstrapRangeRead = {
    cutoff: new Date(Date.now() - 48 * 3_600_000),
    maxSessionId,
    recordedAtOrBefore: new Date(Date.now() + 3_600_000),
  };
  const page = await explain(sessionsSinceStatement(f.tenant.company, range, null, 100));
  const count = await explain(countSessionsSinceStatement(f.tenant.company, range));
  for (const plan of [page, count]) {
    const nodes = f.planNodes(plan);
    const sessionNodes = nodes.filter((node) => node['Relation Name'] === 'service_sessions');
    expect(sessionNodes.length).toBeGreaterThan(0);
    expect(sessionNodes.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    expect(JSON.stringify(plan)).toMatch(
      /service_sessions_(company_id_id_pk|pkey|customer_day_idx|business_id_key|business_day_idx)/,
    );
  }
}, 120_000);

function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute<Record<string, unknown>>(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}`),
  );
}

// زيارات بعد التجميد (معرفاتها أعلى من الحد المجمد) وأخرى قديمة قبل القطع، فتبقى النتيجة نطاق
// واحد صغير والـ planner يقرأه بمفتاح service_sessions.
async function plantSessions() {
  const company = f.tenant.company;
  for (let batch = 0; batch < 10; batch += 1) {
    const chunk: string[] = [];
    for (let index = 0; index < 300; index += 1) chunk.push(f.ids.newId());
    await f.owner`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id', g.id::uuid::text,
        'occurred_at', (now() - (n || ' hours')::interval),
        'business_date', (now() - (n || ' hours')::interval)::date))).*
      FROM service_sessions s, unnest(string_to_array(${chunk.join(',')}, ',')) AS g(id),
        generate_series(1,300) AS h(n)
      WHERE s.company_id=${company} AND s.id=${f.seeded.id}`;
  }
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE service_lines`;
  await f.owner`ANALYZE line_performers`;
}
