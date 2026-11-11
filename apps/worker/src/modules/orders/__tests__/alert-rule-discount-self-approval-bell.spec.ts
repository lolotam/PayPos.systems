import { discountSelfApprovalNoticeRequested } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { ApprovalScope } from './discount-approval-notice-data.ts';
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

async function saveRule(
  scope: ApprovalScope,
  branchId: string | null,
  enabled: boolean,
  roles: readonly string[],
  channels: readonly string[] = ['IN_APP'],
): Promise<void> {
  // تمرير OID النوع _text بيحافظ على معنى المصفوفة الفاضية كقنوات، مش كسلسلة نصية.
  await f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${scope.company},${f.ids.newId()},${scope.business},${branchId},${KIND},${enabled},
      ${f.owner.array([...roles], 1009)},${f.owner.array([...channels], 1009)},NULL,NULL,${USER},1)`;
}

async function setMaster(scope: ApprovalScope, enabled: boolean | null): Promise<void> {
  await f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${scope.company},${scope.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;
}

async function cleanup(scope: ApprovalScope): Promise<void> {
  await f.owner`DELETE FROM alert_rules
    WHERE company_id=${scope.company} AND business_id=${scope.business} AND kind=${KIND}`;
  await f.owner`DELETE FROM business_settings
    WHERE company_id=${scope.company} AND business_id=${scope.business}`;
}

async function branchManager(scope: ApprovalScope): Promise<string> {
  const userId = await f.user();
  await f.member(userId, 'branch_manager', 'BRANCH', scope.branch);
  return userId;
}

function recipientIds(rows: Record<string, unknown>[]): string[] {
  const payload = discountSelfApprovalNoticeRequested.parse(rows[0]?.['payload']);
  return payload.notification_recipients.map((recipient) => recipient.user_id);
}

it('uses the default owner recipient without a saved rule or master row', async () => {
  const scope = await f.otherScope();
  try {
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 1 }]);
    expect(recipientIds(await f.bells(prepared.event.id))).toEqual([USER]);
  } finally {
    await cleanup(scope);
  }
});

it('adds a branch manager to the owner when the rule includes both roles', async () => {
  const scope = await f.otherScope();
  try {
    const manager = await branchManager(scope);
    await saveRule(scope, null, true, ['owner', 'branch_manager']);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 2 }]);
    const rows = await f.bells(prepared.event.id);
    expect(rows).toHaveLength(1);
    expect(recipientIds(rows).sort()).toEqual([USER, manager].sort());
  } finally {
    await cleanup(scope);
  }
});

it('records zero recipients and no bell when the business rule is off', async () => {
  const scope = await f.otherScope();
  try {
    await saveRule(scope, null, false, ['owner']);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});

it('lets a branch rule switch the kind off while the business rule stays on', async () => {
  const scope = await f.otherScope();
  try {
    await saveRule(scope, null, true, ['owner']);
    await saveRule(scope, scope.branch, false, ['owner']);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});

it('records zero recipients and no bell when the master switch is off', async () => {
  const scope = await f.otherScope();
  try {
    await setMaster(scope, false);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});

it('treats a null master as enabled after an earlier master-off event stays silent', async () => {
  const scope = await f.otherScope();
  try {
    await setMaster(scope, false);
    const silent = await f.selfApproval({ scope });
    expect(await f.deliver(silent.event)).toEqual({ delivered: true });
    expect(await f.notices(silent.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(silent.event.id)).toHaveLength(0);

    await setMaster(scope, null);
    const ringing = await f.selfApproval({ scope });
    expect(await f.deliver(ringing.event)).toEqual({ delivered: true });
    expect(recipientIds(await f.bells(ringing.event.id))).toEqual([USER]);
    expect(await f.notices(silent.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(silent.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});

it('records zero recipients without throwing when the rule has no IN_APP channel', async () => {
  const scope = await f.otherScope();
  try {
    await saveRule(scope, null, true, ['owner'], []);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});

it('retains the zero-recipient decision when replayed after re-enabling the rule', async () => {
  const scope = await f.otherScope();
  try {
    await saveRule(scope, null, false, ['owner']);
    const prepared = await f.selfApproval({ scope });
    expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);

    await f.owner`UPDATE alert_rules SET enabled=true
      WHERE company_id=${scope.company} AND business_id=${scope.business} AND branch_id IS NULL AND kind=${KIND}`;
    await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId}
      AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
    await f.consume(prepared.event);
    expect(await f.notices(prepared.event.id)).toHaveLength(1);
    expect(await f.notices(prepared.event.id)).toMatchObject([{ recipient_count: 0 }]);
    expect(await f.bells(prepared.event.id)).toHaveLength(0);
  } finally {
    await cleanup(scope);
  }
});
