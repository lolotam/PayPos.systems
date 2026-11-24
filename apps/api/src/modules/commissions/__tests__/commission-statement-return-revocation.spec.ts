import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  generateStatement,
  memberWithGrants,
  readStatement,
  statementFixture,
  statementPath,
  type StatementFixture,
} from './commission-statement.fixture.ts';

/**
 * سحب الصلاحية اللي بيلتزم والطلب بيستنى (CM-33d بالزمن): فحص الإرجاع بيقفل الشركة وعضوياتها
 * بـ FOR SHARE زي مسار المراجعة بالظبط، فسحب الصلاحية ما يقدرش يلتزم بين فحص الوصول وتغيير
 * حالة الكشف — القرار بيتاخد بعد الانتظار، والرفض الموحّد 403 بيرجع بلا أي كتابة.
 */

let f: StatementFixture;
let owner: postgres.Sql;

beforeAll(async () => {
  f = await statementFixture();
  owner = postgres(f.h.urls.owner, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await f?.h.close();
});

async function statementRow(
  period: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await owner`SELECT status FROM commission_statements
    WHERE company_id=${f.company} AND business_id=${f.business} AND period=${period}`;
  return row;
}

async function returnAuditCount(): Promise<number> {
  const [row] = await owner`SELECT count(*)::int AS count FROM audit_log
    WHERE action='commission_statement.returned'`;
  return row?.['count'] as number;
}

async function returnsRowCount(): Promise<number> {
  const [row] = await owner`SELECT count(*)::int AS count FROM commission_statement_returns
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  return row?.['count'] as number;
}

/** يستنى معاملة التطبيق لحد ما تتعلىق على قفل العضويات (FOR SHARE)، بميزانية زمن صريحة. */
async function waitForMembershipShareWait(budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const [row] = await owner`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity s
      WHERE s.datname = current_database() AND s.wait_event_type = 'Lock'
        AND s.query ~* 'FROM\\s+memberships\\s+WHERE.*FOR\\s+SHARE'
        AND s.pid <> pg_backend_pid()) AS blocked`;
    if (row?.['blocked'] === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** يستنى معاملة الحاجز لحد ما قفل FOR UPDATE بتاعها يبقى مأخوذ فعلاً، بميزانية زمن صريحة. */
async function waitForMembershipUpdateHeld(budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const [row] = await owner`SELECT EXISTS (
      SELECT 1 FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.granted AND l.relation = 'memberships'::regclass
        AND l.mode = 'RowExclusiveLock'
        AND a.state = 'idle in transaction'
        AND a.query ~* 'FROM\\s+memberships\\s+WHERE.*FOR\\s+UPDATE'
        AND a.pid <> pg_backend_pid()) AS held`;
    if (row?.['held'] === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** يولّد الكشف ويراجعه ببصمتيه، فيصير REVIEWED جاهزاً لمحاولة الإرجاع. */
async function seedReviewedStatement(generateKey: string, reviewKey: string): Promise<void> {
  expect((await generateStatement(f, f.cookie, generateKey, '2026-11')).status).toBe(200);
  const view = (await readStatement(f, f.cookie, '2026-11')).body as {
    current_fingerprint: string;
    current_statement_fingerprint: string;
  };
  const reviewed = await f.h.send(
    'POST',
    statementPath(f.business, '2026-11', '/review'),
    {
      cookie: f.cookie,
      company: f.company,
      key: reviewKey,
      body: {
        expected_fingerprint: view.current_fingerprint,
        expected_statement_fingerprint: view.current_statement_fingerprint,
      },
    },
  );
  expect(reviewed.status).toBe(200);
}

/** يحاول الإرجاع بCookie العضوية ومفتاح مطالبة. */
const attemptReturn = (cookie: string, key: string) =>
  f.h.send('POST', statementPath(f.business, '2026-11', '/return'), {
    cookie,
    company: f.company,
    key,
    body: { reason: 'سحب الصلاحية أثناء الانتظار' },
  });

/** يسحب كل صلاحيات عضويات الفاعل بـ SQL مباشر (سحب متزامن اللي بيثبت ترتيب الفحص بعد الانتظار). */
const revokeMemberGrants = (membershipIds: readonly string[]) =>
  owner`DELETE FROM role_permissions
    WHERE company_id=${f.company}
      AND role_id IN (SELECT role_id FROM memberships
        WHERE company_id=${f.company} AND id = ANY(${[...membershipIds]}::uuid[]))`;

it(
  'a revocation that commits while the return waits on the membership lock answers the uniform 403 and writes nothing',
  { timeout: 60_000 },
  async () => {
    await seedReviewedStatement('revoke-generate', 'revoke-review');
    const member = await memberWithGrants(f, 'return-revoke', [
      { permission: 'approve:commissions:business', scope: 'BUSINESS' },
      { permission: 'read:commissions:business', scope: 'BUSINESS' },
    ]);
    const auditBefore = await returnAuditCount();
    const returnsBefore = await returnsRowCount();

    let releaseHolder: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = owner.begin(async (tx) => {
      // محاكاة إدارة الصلاحيات ماسكة قفل العضويات (FOR UPDATE) قبل وصول طلب الإرجاع.
      await tx`SELECT id FROM memberships WHERE company_id=${f.company} ORDER BY id FOR UPDATE`;
      await gate;
    });

    // بنستنى قفل الحاجز يبقى مأخوذ فعلاً قبل ما نبدأ طلب الإرجاع، بلا أي انتظار زمني ثابت.
    const held = await waitForMembershipUpdateHeld(15_000);
    const attempt = attemptReturn(member.cookie, 'return-revoked');
    const blocked = await waitForMembershipShareWait(15_000);
    try {
      expect(held).toBe(true);
      expect(blocked).toBe(true);
      // السحب بيلتزم والطلب لسه واقف على القفل، وبعدها البوابة بتفتح فالقفل بيتحرر.
      await revokeMemberGrants(member.membershipIds);
    } finally {
      releaseHolder();
      await holder;
    }

    const response = await attempt;
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    expect((await statementRow('2026-11'))?.['status']).toBe('REVIEWED');
    expect(await returnsRowCount()).toBe(returnsBefore);
    expect(await returnAuditCount()).toBe(auditBefore);
  },
);
