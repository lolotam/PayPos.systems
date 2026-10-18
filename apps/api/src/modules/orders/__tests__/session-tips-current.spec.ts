import { sessionTips } from '@pospay/contracts';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SessionTipsCurrentQuery, SessionTipsReadError, sessionTipsCurrentStatement, type SessionTipsScope } from '../queries/session-tips-current.query.ts';
import { ids, pairLine, recordVisit, runTips, tip, tipFixture, tipInput, type TipFixture } from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
beforeAll(async () => { f = await tipFixture(); });
afterAll(async () => { await f?.close(); });

function scope(sessionId: string): SessionTipsScope {
  return { companyId: f.company, userId: f.userId, businessId: f.business, branchId: f.branch, sessionId };
}
function byTip(left: { employee_id: string; method: string }, right: { employee_id: string; method: string }) {
  const byEmployee = left.employee_id.toLowerCase() < right.employee_id.toLowerCase() ? -1
    : left.employee_id.toLowerCase() > right.employee_id.toLowerCase() ? 1 : 0;
  if (byEmployee !== 0) return byEmployee;
  return left.method < right.method ? -1 : left.method > right.method ? 1 : 0;
}

it('returns the empty contract, the sorted current set, and a cleared revision', async () => {
  const visit = await recordVisit(f, [pairLine(f)]);
  const query = new SessionTipsCurrentQuery(f.db);
  expect(sessionTips.parse(await query.execute(scope(visit.sessionId)))).toEqual({
    revision: 0, tips: [], total_cash: '0.000', total_card: '0.000',
  });
  const sent = [tip(f, 0, 'CASH', '1.500'), tip(f, 0, 'CARD', '2.250'), tip(f, 1, 'CASH', '3.000')];
  const saved = sessionTips.parse(await runTips(f, visit.sessionId, tipInput(sent)));
  const current = sessionTips.parse(await query.execute(scope(visit.sessionId)));
  expect(current).toEqual(saved);
  expect(current.tips).toEqual([...sent].sort(byTip));
  expect(current).toMatchObject({ total_cash: '4.500', total_card: '2.250' });
  expect(Object.keys(current).sort()).toEqual(['revision', 'tips', 'total_card', 'total_cash']);
  expect(JSON.stringify(current)).not.toMatch(/phone|customer|reason/i);
  const cleared = sessionTips.parse(await runTips(f, visit.sessionId, tipInput([], { expected_revision: 1, reason: 'clear the set' })));
  expect(await query.execute(scope(visit.sessionId))).toEqual(cleared);
  expect(cleared).toEqual({ revision: 2, tips: [], total_cash: '0.000', total_card: '0.000' });
});

it('an unknown session and a session outside the branch are the same read error', async () => {
  const visit = await recordVisit(f);
  const query = new SessionTipsCurrentQuery(f.db);
  const unknown = query.execute(scope(ids.newId())).then(() => null, (error: unknown) => error);
  const branch = ids.newId();
  const sessionId = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branch},${f.business},'Synthetic tip branch')`;
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT ${f.company},${sessionId},${f.business},${branch},${f.customer},s.customer_name,s.customer_phone_masked,
      s.occurred_at,s.recorded_at,s.business_date,s.business_timezone,${f.userId},${f.membership},s.late
    FROM service_sessions s WHERE s.company_id=${f.company} AND s.id=${visit.sessionId}`;
  const outside = query.execute(scope(sessionId)).then(() => null, (error: unknown) => error);
  const [unknownError, outsideError] = await Promise.all([unknown, outside]);
  expect(unknownError).toBeInstanceOf(SessionTipsReadError);
  expect(outsideError).toBeInstanceOf(SessionTipsReadError);
  expect(unknownError).toMatchObject({ code: 'SESSION_NOT_FOUND', message: 'SESSION_NOT_FOUND' });
  expect(outsideError).toMatchObject({ code: 'SESSION_NOT_FOUND', message: 'SESSION_NOT_FOUND' });
});

it('the current-set statement takes no row or advisory lock', () => {
  const text = new PgDialect().sqlToQuery(sessionTipsCurrentStatement(scope(ids.newId()))).sql.toLowerCase();
  expect(text).not.toMatch(/for update|for share|pg_advisory/);
  expect(text).toContain('session_tip_revisions');
  expect(text).toContain('session_tips');
});
