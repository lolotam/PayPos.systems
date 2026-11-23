import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  generateStatement,
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
    const member = await memberWithGrants(f, 'branch-review', [
      { permission: 'review:commissions:business', scope: 'BRANCH' },
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
    const member = await memberWithGrants(g, 'branch-return', [
      { permission: 'review:commissions:business', scope: 'BRANCH' },
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
