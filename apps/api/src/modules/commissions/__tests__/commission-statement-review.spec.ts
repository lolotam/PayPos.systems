import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  generateStatement,
  ids,
  memberWithGrants,
  readStatement,
  statementFixture,
  statementPath,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = {
  current_fingerprint: string;
  current_statement_fingerprint: string;
  status: string;
};

let f: StatementFixture;
let g: StatementFixture;

beforeAll(async () => {
  f = await statementFixture();
  g = await statementFixture();
});

afterAll(async () => {
  await f?.h.close();
  await g?.h.close();
});

/** البصمتان اللي المراجع شافهما في العرض. */
async function expected(
  fixture: StatementFixture,
  period: string,
): Promise<{ expected_fingerprint: string; expected_statement_fingerprint: string }> {
  const view = (await readStatement(fixture, fixture.cookie, period)).body as unknown as View;
  return {
    expected_fingerprint: view.current_fingerprint,
    expected_statement_fingerprint: view.current_statement_fingerprint,
  };
}

const review = (
  fixture: StatementFixture,
  cookie: string,
  key: string,
  body: { expected_fingerprint: string; expected_statement_fingerprint: string },
  period: string,
) =>
  fixture.h.send('POST', statementPath(fixture.business, period, '/review'), {
    cookie,
    company: fixture.company,
    key,
    body,
  });

const returnStatement = (
  fixture: StatementFixture,
  cookie: string,
  key: string,
  reason: string,
  period: string,
) =>
  fixture.h.send('POST', statementPath(fixture.business, period, '/return'), {
    cookie,
    company: fixture.company,
    key,
    body: { reason },
  });

async function statementRow(
  fixture: StatementFixture,
  period: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await fixture.h.owner`SELECT status, current_fingerprint, reviewed_fingerprint,
    reviewed_statement_fingerprint, reviewed_by, reviewed_membership_id, reviewed_at
    FROM commission_statements
    WHERE company_id=${fixture.company} AND business_id=${fixture.business} AND period=${period}`;
  return row;
}

async function auditCount(fixture: StatementFixture, action: string): Promise<number> {
  const [row] = await fixture.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE action=${action}`;
  return row?.['count'] as number;
}

async function noticeEvents(fixture: StatementFixture): Promise<{ payload: unknown }[]> {
  return fixture.h.owner`SELECT payload FROM outbox WHERE event_type='StatementAwaitingApproval'`;
}

describe('CM-30 reviewing a month that has ended', () => {
  it('stores REVIEWED with both reviewed fingerprints, the reviewer and the time, and audits it once', async () => {
    const body = await expected(f, '2026-11');
    const before = await auditCount(f, 'commission_statement.reviewed');
    const response = await review(f, f.cookie, 'review-november', body, '2026-11');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'REVIEWED',
      reviewed_fingerprint: body.expected_fingerprint,
      reviewed_statement_fingerprint: body.expected_statement_fingerprint,
    });
    const row = await statementRow(f, '2026-11');
    expect(row).toMatchObject({
      status: 'REVIEWED',
      reviewed_fingerprint: body.expected_fingerprint,
      reviewed_statement_fingerprint: body.expected_statement_fingerprint,
    });
    expect(row?.['reviewed_by']).toBeTruthy();
    expect(row?.['reviewed_membership_id']).toBeTruthy();
    expect(row?.['reviewed_at']).toBeTruthy();
    expect(await auditCount(f, 'commission_statement.reviewed')).toBe(before + 1);
  });

  it('appends one StatementAwaitingApproval notice for the approvers, in the same transaction', async () => {
    const body = await expected(f, '2026-10');
    const before = (await noticeEvents(f)).length;
    await review(f, f.cookie, 'review-november-notice', body, '2026-10');

    const events = await noticeEvents(f);
    expect(events.length).toBe(before + 1);
    const payload = events.at(-1)?.payload as {
      notification_recipients: { user_id: string; template_key: string }[];
      period: string;
    };
    expect(payload.period).toBe('2026-10');
    expect(payload.notification_recipients.length).toBeGreaterThan(0);
    for (const recipient of payload.notification_recipients) {
      expect(recipient.template_key).toBe('statement_awaiting_approval');
    }
  });

  it('refuses to review a month that is already reviewed', async () => {
    const body = await expected(f, '2026-09');
    const first = await review(f, f.cookie, 'review-twice', body, '2026-09');
    expect(first.status).toBe(200);
    const second = await review(f, f.cookie, 'review-twice-again', body, '2026-09');
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('COMMISSION_PERIOD_NOT_DRAFT');
  });
});

describe('CM-31 the review refuses a stale fingerprint and a blocking issue', () => {
  it('refuses a stale expected fingerprint with the current fingerprints (409)', async () => {
    const body = await expected(f, '2026-08');
    const stale = { ...body, expected_fingerprint: 'f'.repeat(64) };
    const response = await review(f, f.cookie, 'review-stale', stale, '2026-08');

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_FINGERPRINT_STALE');
    const details = (response.body as { details: Record<string, unknown> }).details;
    expect(details['current_fingerprint']).toBe(body.expected_fingerprint);
    expect(details['current_statement_fingerprint']).toBe(body.expected_statement_fingerprint);
    expect(details['changed']).toBe('INPUTS');
  });

  it('refuses a month that is the stored target of an open blocked correction (FR-048)', async () => {
    // التوليد بيعمل صف الكشف مسودة من غير ما يراجعه، فالتوقف الموقوف بيتحجز على شهر لسه مفتوح.
    expect((await generateStatement(f, f.cookie, 'generate-july', '2026-07')).status).toBe(200);
    const [statement] = await f.h.owner`SELECT id FROM commission_statements
      WHERE company_id=${f.company} AND business_id=${f.business} AND period='2026-07'`;
    await f.h.owner`INSERT INTO commission_blocked_corrections(
      company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
      target_statement_id)
      VALUES (${f.company},gen_random_uuid(),${f.business},${f.employee},'2026-06','NO_PLAN',
        gen_random_uuid(),'2026-07',${statement?.['id']}::uuid)`;

    const target = await expected(f, '2026-07');
    const response = await review(f, f.cookie, 'review-blocked', target, '2026-07');
    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('COMMISSION_STATEMENT_BLOCKED');
    const details = (response.body as { details: { issues: { employee_id: string; code: string }[] } })
      .details;
    expect(details.issues).toEqual([{ employee_id: f.employee, code: 'NO_PLAN' }]);
  });
});

describe('CM-33 the review permission', () => {
  it('refuses a member with neither review nor approve (403)', async () => {
    const member = await memberWithGrants(f, 'plain', [
      { permission: 'read:commissions:business', scope: 'BUSINESS' },
    ]);
    const body = await expected(f, '2026-06');
    const response = await review(f, member.cookie, 'review-no-permission', body, '2026-06');

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('refuses a member with review on a branch only, and writes nothing (CM-33d)', async () => {
    // سيناريو CM-33d: الكشف موجود الأول (مولَّد للشهر)، وصلاحية المراجعة على النشاط مع قراءة
    // فرع فقط — الحارس بيمرّر المنح على النشاط، فالرفض الموحّد بيجي من الفحص جوّه المعاملة:
    // الكشف بيفضل مسودة، بلا بصمة ولا تدقيق.
    expect((await generateStatement(f, f.cookie, 'generate-may', '2026-05')).status).toBe(200);
    const member = await memberWithGrants(f, 'branch-review', [
      { permission: 'review:commissions:business', scope: 'BUSINESS' },
      { permission: 'read:commissions:business', scope: 'BRANCH' },
    ]);
    const before = await auditCount(f, 'commission_statement.reviewed');
    const body = await expected(f, '2026-05');
    const response = await review(f, member.cookie, 'review-branch', body, '2026-05');

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    expect(response.text).not.toContain(body.expected_fingerprint);
    expect((await statementRow(f, '2026-05'))?.['status']).toBe('DRAFT');
    expect(await auditCount(f, 'commission_statement.reviewed')).toBe(before);
  });
});

describe('CM-33b returning a reviewed statement to draft', () => {
  it('clears the review, stores the reason in one row and audits once without the reason', async () => {
    const body = await expected(g, '2026-11');
    await review(g, g.cookie, 'review-november', body, '2026-11');
    const reason = 'خطة سوسن غلط';
    const before = await auditCount(g, 'commission_statement.returned');
    const response = await returnStatement(g, g.cookie, 'return-november', reason, '2026-11');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'DRAFT' });
    const row = await statementRow(g, '2026-11');
    expect(row).toMatchObject({
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    });
    const [stored] = await g.h.owner`SELECT reason FROM commission_statement_returns
      WHERE company_id=${g.company} AND business_id=${g.business} AND statement_id=
        (SELECT id FROM commission_statements
          WHERE company_id=${g.company} AND business_id=${g.business} AND period='2026-11')`;
    expect(stored?.['reason']).toBe(reason);
    expect(await auditCount(g, 'commission_statement.returned')).toBe(before + 1);
    const [entry] = await g.h.owner`SELECT after FROM audit_log
      WHERE action='commission_statement.returned' ORDER BY at DESC LIMIT 1`;
    expect(JSON.stringify(entry)).not.toContain(reason);
  });

  it('refuses an empty reason with 422 and writes nothing', async () => {
    const body = await expected(g, '2026-10');
    await review(g, g.cookie, 'review-october', body, '2026-10');
    const response = await returnStatement(g, g.cookie, 'return-empty', '   ', '2026-10');

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('COMMISSION_RETURN_REASON_INVALID');
    expect((await statementRow(g, '2026-10'))?.['status']).toBe('REVIEWED');
  });

  it('refuses a statement that is not reviewed with 409', async () => {
    const response = await returnStatement(g, g.cookie, 'return-draft', 'سبب', '2026-09');
    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_STATEMENT_NOT_REVIEWED');
  });

  it('refuses the return of an APPROVED month with COMMISSION_PERIOD_CLOSED under the lock', async () => {
    // الشهر المعتمد بيرفض تحت قفل الكشف قبل فحص الحالة: 409 COMMISSION_PERIOD_CLOSED بلا أي كتابة.
    expect((await generateStatement(g, g.cookie, 'generate-august', '2026-08')).status).toBe(200);
    const body = await expected(g, '2026-08');
    expect((await review(g, g.cookie, 'review-august', body, '2026-08')).status).toBe(200);
    await g.h
      .owner`UPDATE commission_statements SET status='APPROVED'
      WHERE company_id=${g.company} AND business_id=${g.business} AND period='2026-08'`;
    const response = await returnStatement(g, g.cookie, 'return-approved', 'سبب', '2026-08');

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_CLOSED');
    expect((await statementRow(g, '2026-08'))?.['status']).toBe('APPROVED');
  });
});

describe('CM-33b who may return a reviewed statement', () => {
  it('refuses a member with neither review nor approve (403)', async () => {
    const member = await memberWithGrants(g, 'plain-return', [
      { permission: 'read:commissions:business', scope: 'BUSINESS' },
    ]);
    const response = await returnStatement(
      g,
      member.cookie,
      'return-no-permission',
      'سبب',
      '2026-08',
    );
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('refuses a member whose review grant is on a branch only (CM-33d)', async () => {
    // منح المراجعة على النشاط مع قراءة فرع فقط: الحارس بيمرّر المنح، فالرفض الموحّد بيجي من فحص
    // القراءة على مستوى النشاط كله جوّه المعاملة، والكشف بيفضل مراجَع بلا أي كتابة (CM-33d).
    const member = await memberWithGrants(g, 'branch-return', [
      { permission: 'review:commissions:business', scope: 'BUSINESS' },
      { permission: 'read:commissions:business', scope: 'BRANCH' },
    ]);
    const body = await expected(g, '2026-07');
    await review(g, g.cookie, 'review-july', body, '2026-07');
    const response = await returnStatement(g, member.cookie, 'return-branch', 'سبب', '2026-07');

    expect(response.status).toBe(403);
    expect((await statementRow(g, '2026-07'))?.['status']).toBe('REVIEWED');
  });

  it('lets a holder of approve but not review return the statement (FR-031)', async () => {
    const member = await memberWithGrants(g, 'approver', [
      { permission: 'approve:commissions:business', scope: 'BUSINESS' },
      { permission: 'read:commissions:business', scope: 'BUSINESS' },
    ]);
    const body = await expected(g, '2026-06');
    await review(g, g.cookie, 'review-june', body, '2026-06');
    const response = await returnStatement(g, member.cookie, 'return-june', 'سبب', '2026-06');

    expect(response.status).toBe(200);
    expect((await statementRow(g, '2026-06'))?.['status']).toBe('DRAFT');
  });
});

/**
 * عضو واحد بثنتين عضويات صاحب اعتماد: واحدة على نشاط ثانٍ لنفس الشركة بمعرّف أصغر، وواحدة على
 * النشاط المطلوب بمعرّف أكبر — الترتيب ده كان بيجيب نسب الإرجاع الغلط قبل الإصلاح.
 */
async function twoBusinessApprover(): Promise<{ cookie: string; userId: string; thisMembership: string }> {
  const secondBusiness = (
    await g.h.send('POST', '/v1/businesses', {
      cookie: g.cookie,
      company: g.company,
      key: 'review-second-business',
      body: { vertical_type: 'salon', name_en: 'Second review salon', timezone: 'Asia/Kuwait' },
    })
  ).body['id'] as string;
  const email = `commission-statement-two-biz-${ids.newId()}@example.test`;
  const cookie = await g.h.signedInOperator(email);
  const [user] = await g.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  // عضوية النشاط التاني بمعرّف أصغر — كانت بتكسب في ترتيب «الأقدم» قبل الإصلاح.
  const otherMembership = '01900000-0000-7000-8000-000000000001';
  const thisMembership = '01930000-0000-7000-8000-000000000001';
  const roleA = '01900000-0000-7000-8000-000000000002';
  const roleB = '01930000-0000-7000-8000-000000000002';
  for (const [role, code, membershipId, scopeId] of [
    [roleA, 'statement_two_biz_other', otherMembership, secondBusiness],
    [roleB, 'statement_two_biz_this', thisMembership, g.business],
  ] as const) {
    await g.h.owner`INSERT INTO roles(id,company_id,code,name_en)
      VALUES (${role},${g.company},${code},'Two business approver role')`;
    await g.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${role},${g.company},${g.company},'approve:commissions:business'),
        (${role},${g.company},${g.company},'read:commissions:business')`;
    await g.h.owner`INSERT INTO memberships(
      company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${g.company},${membershipId},${userId},${role},${g.company},'BUSINESS',${scopeId}::uuid)`;
  }
  return { cookie, userId, thisMembership };
}

describe('CM-33b the return attribution names the membership with authority over this business', () => {
  it('records the membership that carries authority over this business, never one of another business', async () => {
    const approver = await twoBusinessApprover();
    expect((await generateStatement(g, g.cookie, 'generate-may-two', '2026-05')).status).toBe(200);
    const body = await expected(g, '2026-05');
    await review(g, g.cookie, 'review-may-two', body, '2026-05');
    const response = await returnStatement(g, approver.cookie, 'return-two-biz', 'سبب', '2026-05');

    expect(response.status).toBe(200);
    const [row] = await g.h.owner`SELECT returned_by, returned_membership_id
      FROM commission_statement_returns
      WHERE company_id=${g.company} AND business_id=${g.business}
        AND statement_id=(SELECT id FROM commission_statements
          WHERE company_id=${g.company} AND business_id=${g.business} AND period='2026-05')`;
    expect(row?.['returned_by']).toBe(approver.userId);
    expect(row?.['returned_membership_id']).toBe(approver.thisMembership);
  });
});
