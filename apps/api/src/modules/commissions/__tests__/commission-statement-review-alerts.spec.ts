import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  generateStatement,
  readStatement,
  statementFixture,
  statementPath,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = { current_fingerprint: string; current_statement_fingerprint: string };

let f: StatementFixture;

beforeAll(async () => {
  f = await statementFixture();
});

afterAll(async () => {
  await f?.h.close();
});

/** مفتاح الاعتماد الصريح للشركة: المطالبة بالاعتماد بتتطلبه (53-2-B2a-FR030-1). */
const SWITCH_FLAG = 'commission_statement_approval';

async function ownerUserId(): Promise<string> {
  const [row] = await f.h
    .owner`SELECT id FROM "user" WHERE email='commission-estimate-owner@example.test'`;
  return row?.['id'] as string;
}

/** يرجّع الحالة الافتراضية قبل كل اختبار: المفتاح الصريح شغّال، ولا قاعدة مخزّنة، والمفتاح العام فاضي. */
beforeEach(async () => {
  await f.h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${f.company}, ${SWITCH_FLAG}, true, 'alerts fixture', ${await ownerUserId()})
    ON CONFLICT (company_id, flag) DO UPDATE SET enabled = true, expires_at = NULL`;
  await f.h.owner`DELETE FROM alert_rules WHERE company_id=${f.company} AND business_id=${f.business}`;
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, alerts_enabled)
    VALUES (${f.company}, ${f.business}, NULL)
    ON CONFLICT (company_id, business_id) DO UPDATE SET alerts_enabled = NULL`;
});

async function disableKind(kind: string): Promise<void> {
  await f.h.owner`INSERT INTO alert_rules (company_id, id, business_id, branch_id, kind, enabled,
      recipient_roles, channels, delay_minutes, lead_minutes, updated_by, revision)
    VALUES (${f.company}, gen_random_uuid(), ${f.business}, NULL, ${kind}, false,
      ARRAY['owner']::text[], ARRAY['IN_APP']::text[], NULL, NULL, ${await ownerUserId()}, 1)`;
}

async function disableMaster(): Promise<void> {
  await f.h.owner`UPDATE business_settings SET alerts_enabled = false
    WHERE company_id=${f.company} AND business_id=${f.business}`;
}

async function noticeCount(): Promise<number> {
  const [row] = await f.h.owner`SELECT count(*)::int AS count FROM outbox
    WHERE company_id=${f.company} AND event_type='StatementAwaitingApproval'`;
  return row?.['count'] as number;
}

async function latestNoticeRecipients(): Promise<string[]> {
  const [row] = await f.h.owner`SELECT payload FROM outbox
    WHERE company_id=${f.company} AND event_type='StatementAwaitingApproval'
    ORDER BY id DESC LIMIT 1`;
  const payload = row?.['payload'] as { notification_recipients?: { user_id: string }[] } | undefined;
  return (payload?.notification_recipients ?? []).map((recipient) => recipient.user_id);
}

/** يولّد كشف الشهر ويراجعه، ويرجّع حالة الرد. */
async function reviewPeriod(period: string): Promise<{ status: number; body: unknown }> {
  expect((await generateStatement(f, f.cookie, `generate-${period}`, period)).status).toBe(200);
  const view = (await readStatement(f, f.cookie, period)).body as unknown as View;
  return f.h.send('POST', statementPath(f.business, period, '/review'), {
    cookie: f.cookie,
    company: f.company,
    key: `review-${period}`,
    body: {
      expected_fingerprint: view.current_fingerprint,
      expected_statement_fingerprint: view.current_statement_fingerprint,
    },
  });
}

describe('RT-26 the review notice follows the statement alert rules', () => {
  it('appends the approval notice by default, with no stored rule', async () => {
    const before = await noticeCount();
    const response = await reviewPeriod('2026-02');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'REVIEWED' });
    expect(await noticeCount()).toBe(before + 1);
    expect(await latestNoticeRecipients()).toContain(await ownerUserId());
  });

  it('reviews successfully but appends no notice while STATEMENT_AWAITING_APPROVAL is off', async () => {
    await disableKind('STATEMENT_AWAITING_APPROVAL');
    const before = await noticeCount();
    const response = await reviewPeriod('2026-01');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'REVIEWED' });
    expect(await noticeCount()).toBe(before);
  });

  it('reviews successfully but appends no notice while the alerts master switch is off', async () => {
    await disableMaster();
    const before = await noticeCount();
    const response = await reviewPeriod('2025-12');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'REVIEWED' });
    expect(await noticeCount()).toBe(before);
  });
});
