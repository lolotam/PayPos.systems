import { discountSelfApprovalNoticeRequested } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  discountSelfApprovalFixture,
  type DiscountSelfApprovalFixture,
} from './discount-self-approval-notice.fixture.ts';

let f: DiscountSelfApprovalFixture;
beforeAll(async () => {
  f = await discountSelfApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

const KIND = 'DISCOUNT_SELF_APPROVED';
const saveRule = (company: string, business: string, roles: string[]) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${company},${f.ids.newId()},${business},NULL,${KIND},true,
      ${f.owner.array(roles)},ARRAY['IN_APP']::text[],NULL,NULL,${USER},1)`;

it('101 owners ring in two outbox groups of 100 and 1, counted once in the ledger', async () => {
  const scope = await f.otherCompany();
  const owners: string[] = [];
  let approverMembership = '';
  for (let index = 0; index < 101; index += 1) {
    const user = await f.user();
    const membershipId = await f.member(user, 'owner', 'COMPANY', scope.company);
    if (index === 0) approverMembership = membershipId;
    owners.push(user);
  }
  const prepared = await f.decision({
    scope,
    decider: { userId: owners[0] as string, membershipId: approverMembership },
  });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  expect(ledger).toMatchObject({ recipient_count: 101 });
  const rows = await f.decisions(prepared.companyId, ledger?.['id'] as string);
  expect(rows).toHaveLength(2);
  const groups = rows.map(
    (row) =>
      discountSelfApprovalNoticeRequested.parse(row['payload']).notification_recipients.length,
  );
  expect(groups).toEqual([100, 1]);
  const recipients = rows.flatMap((row) =>
    discountSelfApprovalNoticeRequested
      .parse(row['payload'])
      .notification_recipients.map((recipient) => recipient.user_id),
  );
  expect(recipients).toEqual([...owners].sort());
});

it('a user holding two matching roles is deduped into one bell and counted once', async () => {
  const scope = await f.otherCompany();
  await saveRule(scope.company, scope.business, ['owner', 'branch_manager']);
  try {
    const approver = await f.user();
    const approverMembership = await f.member(approver, 'owner', 'COMPANY', scope.company);
    const both = await f.user();
    await f.member(both, 'owner', 'COMPANY', scope.company);
    await f.member(both, 'branch_manager', 'BRANCH', scope.branch, undefined, null, scope.company);
    const prepared = await f.decision({
      scope,
      decider: { userId: approver, membershipId: approverMembership },
    });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
    expect(ledger).toMatchObject({ recipient_count: 2 });
    const rows = await f.decisions(prepared.companyId, ledger?.['id'] as string);
    expect(rows).toHaveLength(1);
    const recipients = discountSelfApprovalNoticeRequested
      .parse(rows[0]?.['payload'])
      .notification_recipients.map((recipient) => recipient.user_id);
    expect(recipients).toEqual([approver, both].sort());
  } finally {
    await f.owner`DELETE FROM alert_rules WHERE company_id=${scope.company} AND business_id=${scope.business} AND kind=${KIND}`;
  }
});
