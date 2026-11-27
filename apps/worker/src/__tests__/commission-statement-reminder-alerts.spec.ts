import { createDatabase, SYSTEM_ROLES, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import {
  createStatementReminderTransactions,
  remindCommissionStatements,
} from '../modules/commissions/index.ts';
import { statementReminderAlertRules } from '../modules/commissions/persistence/alert-rule.adapter.ts';
import {
  commissionStatementRecipients,
  readExplicitCompanyFeature,
  teamAlertRecipientContacts,
} from '../modules/identity/index.ts';
import { companyBusinesses, companyFeatureEnabled } from '../modules/tenancy/index.ts';

const A = TENANT.A;
const ids = systemUuidV7();
const DAY_THREE = { now: () => new Date('2026-11-03T06:00:00Z') };

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: Database;
let ownerUserId = '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  await owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${A.company}, 'commissions', true, 'fixture', ${USER}),
           (${A.company}, 'commission_statement_approval', true, 'fixture', ${USER})`;
  ownerUserId = ids.newId();
  const userId = ownerUserId;
  const roleId = SYSTEM_ROLES.find((role) => role.code === 'owner')?.id ?? '';
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'owner',${`${userId}@example.test`})`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${A.company},${ids.newId()},${userId},${roleId},'global','COMPANY',${A.company},'2026-01-01T00:00:00Z')`;
});

afterAll(async () => {
  const results = await Promise.allSettled([app?.close(), owner?.end()]);
  await testDb?.drop();
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed !== undefined) throw failed.reason;
});

beforeEach(async () => {
  await owner`DELETE FROM commission_statement_reminders WHERE company_id = ${A.company}`;
  await owner`DELETE FROM outbox WHERE company_id = ${A.company}`;
  await owner`DELETE FROM alert_rules WHERE company_id = ${A.company}`;
  await owner`UPDATE business_settings SET alerts_enabled = NULL WHERE company_id = ${A.company}`;
});

/** المسار الحقيقي: محوّل القاعدة بيقرا Postgres على معاملة الشركة، والمفتاح العام مطبّق. */
const transactions = (withContacts = true) =>
  createStatementReminderTransactions(app, ids, {
    businesses: companyBusinesses,
    feature: (tx, id) => companyFeatureEnabled(tx, id, 'commissions'),
    recipients: commissionStatementRecipients,
    alertRules: statementReminderAlertRules,
    switch: readExplicitCompanyFeature,
    ...(withContacts ? { contacts: teamAlertRecipientContacts } : {}),
  });

const run = () => remindCommissionStatements({ transactions: transactions(), clock: DAY_THREE }, A.company);

async function ledgerKinds(): Promise<string[]> {
  const rows = await owner`SELECT kind FROM commission_statement_reminders
    WHERE company_id = ${A.company} ORDER BY kind`;
  return rows.map((row) => row['kind'] as string);
}

type NoticeEventSummary = { readonly eventType: string; readonly recipientIds: string[] };

async function noticeEvents(): Promise<NoticeEventSummary[]> {
  const rows = await owner`SELECT event_type, payload FROM outbox
    WHERE company_id = ${A.company}
      AND event_type IN ('StatementAwaitingApproval', 'StatementAwaitingReview')
    ORDER BY event_type`;
  return rows.map((row) => {
    const payload = row['payload'] as { notification_recipients?: { user_id: string }[] };
    return {
      eventType: row['event_type'] as string,
      recipientIds: (payload.notification_recipients ?? []).map((recipient) => recipient.user_id),
    };
  });
}

async function disableKind(kind: string): Promise<void> {
  await owner`INSERT INTO alert_rules (company_id, id, business_id, branch_id, kind, enabled,
      recipient_roles, channels, delay_minutes, lead_minutes, updated_by, revision)
    VALUES (${A.company}, ${ids.newId()}, ${A.business}, NULL, ${kind}, false,
      ARRAY['owner']::text[], ARRAY['IN_APP']::text[], NULL, NULL, ${ownerUserId}, 1)`;
}

it('RT-26: by default day three writes both the approval and the review reminder', async () => {
  const result = await run();

  expect(result.reminders).toBe(2);
  expect(await ledgerKinds()).toEqual(['APPROVAL_DAY3', 'REVIEW_DAY3']);
  expect(await noticeEvents()).toEqual([
    { eventType: 'StatementAwaitingApproval', recipientIds: [ownerUserId] },
    { eventType: 'StatementAwaitingReview', recipientIds: [ownerUserId] },
  ]);
});

it('RT-26: turning STATEMENT_AWAITING_REVIEW off stops only the review reminder', async () => {
  await disableKind('STATEMENT_AWAITING_REVIEW');
  const result = await run();

  expect(result.reminders).toBe(1);
  expect(await ledgerKinds()).toEqual(['APPROVAL_DAY3']);
  expect(await noticeEvents()).toEqual([
    { eventType: 'StatementAwaitingApproval', recipientIds: [ownerUserId] },
  ]);
});

it('RT-26: turning STATEMENT_AWAITING_APPROVAL off stops only the approval reminder', async () => {
  await disableKind('STATEMENT_AWAITING_APPROVAL');
  const result = await run();

  expect(result.reminders).toBe(1);
  expect(await ledgerKinds()).toEqual(['REVIEW_DAY3']);
  expect(await noticeEvents()).toEqual([
    { eventType: 'StatementAwaitingReview', recipientIds: [ownerUserId] },
  ]);
});

it('RT-26: turning the business alerts master switch off stops both reminders', async () => {
  await owner`INSERT INTO business_settings (company_id, business_id, alerts_enabled)
    VALUES (${A.company}, ${A.business}, false)
    ON CONFLICT (company_id, business_id) DO UPDATE SET alerts_enabled = false`;
  const result = await run();

  expect(result.reminders).toBe(0);
  expect(await ledgerKinds()).toEqual([]);
  expect(await noticeEvents()).toEqual([]);
});

async function setChannels(kind: string, channels: string[]): Promise<void> {
  await owner`INSERT INTO alert_rules (company_id, id, business_id, branch_id, kind, enabled,
      recipient_roles, channels, delay_minutes, lead_minutes, updated_by, revision)
    VALUES (${A.company}, ${ids.newId()}, ${A.business}, NULL, ${kind}, true,
      ARRAY['owner']::text[], ${owner.array(channels)}, NULL, NULL, ${ownerUserId}, 1)`;
}

it('62b-1: an email-only approval rule writes a parameterless email recipient for the verified owner and no bell', async () => {
  await owner`UPDATE "user" SET email_verified = true WHERE id = ${ownerUserId}`;
  await setChannels('STATEMENT_AWAITING_APPROVAL', ['EMAIL']);
  await disableKind('STATEMENT_AWAITING_REVIEW');
  const result = await run();

  expect(result.reminders).toBe(1);
  const [row] = await owner`SELECT payload FROM outbox
    WHERE company_id = ${A.company} AND event_type = 'StatementAwaitingApproval'`;
  const payload = row?.['payload'] as { notification_recipients: Record<string, unknown>[] };
  expect(payload.notification_recipients).toEqual([
    {
      channel: 'email',
      email: `${ownerUserId}@example.test`,
      locale: 'ar',
      template_key: 'statement_awaiting_approval',
      template_revision: 1,
      safe_parameters: [],
    },
  ]);
});

it('62b-1: an external channel without a wired contact reader fails loudly instead of dropping the email', async () => {
  await setChannels('STATEMENT_AWAITING_APPROVAL', ['EMAIL']);
  await disableKind('STATEMENT_AWAITING_REVIEW');
  await expect(
    remindCommissionStatements({ transactions: transactions(false), clock: DAY_THREE }, A.company),
  ).rejects.toThrow('TEAM_ALERT_CONTACTS_UNAVAILABLE');
});
