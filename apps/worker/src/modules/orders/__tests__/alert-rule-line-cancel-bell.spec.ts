import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lineCancelFixture, type LineCancelFixture } from './line-cancel-notice.fixture.ts';

let f: LineCancelFixture;
beforeAll(async () => {
  f = await lineCancelFixture();
});
afterAll(async () => {
  await f?.close();
});

const KIND = 'SERVICE_LINE_CANCELLED';
const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const saveRule = (branchId: string | null, enabled: boolean, roles: string[]) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${f.tenant.company},${f.ids.newId()},${f.tenant.business},${branchId},${KIND},${enabled},
      ${f.owner.array(roles)},ARRAY['IN_APP']::text[],NULL,NULL,${USER},1)`;
const clearRules = () =>
  f.owner`DELETE FROM alert_rules
    WHERE company_id=${f.tenant.company} AND business_id=${f.tenant.business} AND kind=${KIND}`;
const setMaster = (enabled: boolean | null) =>
  f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${f.tenant.company},${f.tenant.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;
const bellRecipients = (rows: Record<string, unknown>[]) =>
  rows.flatMap(
    (row) =>
      (row['payload'] as { notification_recipients: { user_id: string; channel: string }[] })
        .notification_recipients,
  );

it('with no saved rule and no master value the bell keeps its default recipients', async () => {
  const prepared = await f.cancel();
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(bellRecipients(await f.requests(prepared.sessionId)).map((recipient) => recipient.user_id))
    .toEqual([USER]);
});

it('a business rule that switches the kind off claims the decision with no recipients and no bell', async () => {
  await saveRule(null, false, MANAGERS);
  try {
    const prepared = await f.cancel();
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});

it('a rule with the owner role only rings the owner and leaves the branch manager out', async () => {
  const manager = await f.user();
  await f.member(manager, 'branch_manager', 'BRANCH', f.tenant.branch);
  await saveRule(null, true, ['owner']);
  try {
    const prepared = await f.cancel();
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(bellRecipients(await f.requests(prepared.sessionId))).toMatchObject([
      { user_id: USER, channel: 'IN_APP' },
    ]);
  } finally {
    await clearRules();
  }
});

it('a branch rule that switches the kind off silences that branch while the business rule stays on', async () => {
  await saveRule(null, true, MANAGERS);
  await saveRule(f.tenant.branch, false, MANAGERS);
  try {
    const prepared = await f.cancel();
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});

it('the master switch off claims the decision with no recipients and no bell', async () => {
  await setMaster(false);
  try {
    const prepared = await f.cancel();
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.lineId)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.requests(prepared.sessionId)).toHaveLength(0);
  } finally {
    await setMaster(null);
  }
});
