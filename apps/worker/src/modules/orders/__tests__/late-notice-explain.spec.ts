import { beforeAll, afterAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { lateNoticeFixture, type LateNoticeFixture } from './late-notice.fixture.ts';
import {
  sessionNoticeMatchStatement,
  lateNoticeClaimStatement,
} from '../persistence/late-service-session-notice.repository.ts';
let f: LateNoticeFixture;
beforeAll(async () => {
  f = await lateNoticeFixture();
});
afterAll(async () => {
  await f?.close();
});
it('exact session probe and permanent claim use tenant indexes and the session conflict arbiter', async () => {
  const session = await f.session();
  const input = await f.event(session);
  await f.deliver(input);
  await f.owner`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
   to_jsonb(s)||jsonb_build_object('id',gen_random_uuid()::text))).* FROM service_sessions s
   CROSS JOIN generate_series(1,2000) WHERE s.company_id=${f.tenant.company} AND s.id=${session}`;
  await f.owner`ANALYZE service_sessions`;
  await f.owner`ANALYZE late_service_session_notices`;
  const payload = input.payload as { business_date: string; business_timezone: string };
  const scope = {
    companyId: f.tenant.company,
    sessionId: session,
    businessId: f.tenant.business,
    branchId: f.tenant.branch,
    businessDate: payload.business_date,
    businessTimezone: payload.business_timezone,
  };
  const explain = (statement: SQL) =>
    f.db.withTenant(f.tenant.company, (tx) =>
      tx.execute(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}`),
    );
  const result = await explain(sessionNoticeMatchStatement(scope));
  const text = JSON.stringify(result);
  expect(text).toMatch(/service_sessions_(company_id_id_pk|business_id_key)/);
  expect(text).not.toContain('Seq Scan');
  const claim = await explain(
    lateNoticeClaimStatement(scope, {
      id: f.ids.newId(),
      sourceEventId: input.id,
      decidedAt: f.at,
      recipientCount: 1,
    }),
  );
  expect(JSON.stringify(claim)).toContain('late_service_session_notices_session_key');
  expect(JSON.stringify(claim)).toContain('NOTHING');
  expect(await f.notices(session)).toHaveLength(1);
});
