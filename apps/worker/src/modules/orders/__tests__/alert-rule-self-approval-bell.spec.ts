import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { PreparedDecision, SelfApprovalScope } from './discount-self-approval-notice-data.ts';
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
const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const saveRule = (
  scope: SelfApprovalScope,
  branchId: string | null,
  enabled: boolean,
  roles: string[],
  channels: string[] = ['IN_APP'],
) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${scope.company},${f.ids.newId()},${scope.business},${branchId},${KIND},${enabled},
      ${f.owner.array(roles)},${f.owner.array(channels)},NULL,NULL,${USER},1)`;
const clearRules = (scope: SelfApprovalScope) =>
  f.owner`DELETE FROM alert_rules
    WHERE company_id=${scope.company} AND business_id=${scope.business} AND kind=${KIND}`;
const setMaster = (scope: SelfApprovalScope, enabled: boolean | null) =>
  f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${scope.company},${scope.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;
const bellUserIds = async (prepared: PreparedDecision) => {
  const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
  const rows = await f.decisions(prepared.companyId, ledger?.['id'] as string);
  return rows.flatMap(
    (row) =>
      (
        row['payload'] as {
          notification_recipients: { user_id: string; channel: string }[];
        }
      ).notification_recipients,
  );
};

it('with no saved rule and no master value the default rule rings every owner including the approver', async () => {
  const scope = await f.otherCompany();
  const approver = await f.user();
  const approverMembership = await f.member(approver, 'owner', 'COMPANY', scope.company);
  const otherOwner = await f.user();
  await f.member(otherOwner, 'owner', 'COMPANY', scope.company);
  const prepared = await f.decision({
    scope,
    decider: { userId: approver, membershipId: approverMembership },
  });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect((await bellUserIds(prepared)).map((recipient) => recipient.user_id).sort()).toEqual(
    [approver, otherOwner].sort(),
  );
});

it('a business rule that adds the branch manager rings every eligible role holder deduplicated', async () => {
  const scope = await f.otherCompany();
  await saveRule(scope, null, true, MANAGERS);
  try {
    const manager = await f.user();
    await f.member(
      manager,
      'branch_manager',
      'BRANCH',
      scope.branch,
      undefined,
      null,
      scope.company,
    );
    const prepared = await f.decision({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect((await bellUserIds(prepared)).map((recipient) => recipient.user_id).sort()).toEqual([
      manager,
    ]);
  } finally {
    await clearRules(scope);
  }
});

it('a business rule that switches the kind off claims the decision with no recipients and no bell', async () => {
  const scope = await f.otherCompany();
  await saveRule(scope, null, false, MANAGERS);
  try {
    const prepared = await f.decision({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
  } finally {
    await clearRules(scope);
  }
});

it('a branch rule that switches the kind off silences that branch while the business rule stays on', async () => {
  const scope = await f.otherCompany();
  await saveRule(scope, null, true, MANAGERS);
  await saveRule(scope, scope.branch, false, MANAGERS);
  try {
    const prepared = await f.decision({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
  } finally {
    await clearRules(scope);
  }
});

it('the master switch off claims the decision with no recipients and no bell', async () => {
  const scope = await f.otherCompany();
  await setMaster(scope, false);
  try {
    const prepared = await f.decision({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
  } finally {
    await setMaster(scope, null);
  }
});

it('a rule without the IN_APP channel claims the decision with no recipients and no bell', async () => {
  const scope = await f.otherCompany();
  // قناة CHECK في 62-1 تمنع أي قيمة غير IN_APP، فالقاعدة بلا القناة تُزرع بمصفوفة قنوات فارغة.
  await saveRule(scope, null, true, MANAGERS, []);
  try {
    const prepared = await f.decision({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
  } finally {
    await clearRules(scope);
  }
});

it('a zero-count decision wins forever: turning the rule on later does not recount or ring', async () => {
  const scope = await f.otherCompany();
  await saveRule(scope, null, false, MANAGERS);
  const prepared = await f.decision({ scope });
  try {
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
  } finally {
    await clearRules(scope);
  }
  await saveRule(scope, null, true, MANAGERS);
  try {
    await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.companyId, prepared.event.id)).toMatchObject([
      { recipient_count: 0 },
    ]);
    const [ledger] = await f.notices(prepared.companyId, prepared.event.id);
    expect(await f.decisions(prepared.companyId, ledger?.['id'] as string)).toHaveLength(0);
  } finally {
    await clearRules(scope);
  }
});
