import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { activeLinesOfCustomerStatement } from '../queries/day-sessions.query.ts';
import { daySessionsFixture, type DaySessionsFixture } from './day-sessions.fixture.ts';

let f: DaySessionsFixture;
beforeAll(async () => {
  f = await daySessionsFixture();
});
afterAll(async () => {
  await f?.close();
});

it('reads the customer day through a service_sessions index', async () => {
  await plantSessions();
  const from = new Date(f.seeded.occurredAt.getTime() - 3_600_000);
  const to = new Date(f.seeded.occurredAt.getTime() + 3_600_000);
  const plan = await explain(
    activeLinesOfCustomerStatement(
      f.tenant.company,
      f.tenant.business,
      f.seeded.customerId,
      from,
      to,
    ),
  );
  const nodes = f.planNodes(plan);
  const sessionNodes = nodes.filter((node) => node['Relation Name'] === 'service_sessions');
  expect(sessionNodes.length).toBeGreaterThan(0);
  expect(sessionNodes.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
  expect(JSON.stringify(plan)).toMatch(
    /service_sessions_(customer_day_idx|company_id_id_pk|business_id_key|pkey|day_idx)/,
  );
}, 120_000);

function explain(statement: SQL) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    tx.execute<Record<string, unknown>>(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}`),
  );
}

// ألفا زيارة قديمة تتوزع على أيام، عشان يوم العميل يفضل صفاً واحداً والـ planner يمشي على الفهرس.
async function plantSessions() {
  const company = f.tenant.company;
  await f.owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id', gen_random_uuid()::text,
        'occurred_at', (now() - (n || ' days')::interval),
        'business_date', (current_date - n::int)))).*
      FROM service_sessions s CROSS JOIN generate_series(1,2000) AS g(n)
      WHERE s.company_id=${company} AND s.id=${f.seeded.id}`;
  });
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE service_lines`;
  await f.owner`ANALYZE line_performers`;
}
