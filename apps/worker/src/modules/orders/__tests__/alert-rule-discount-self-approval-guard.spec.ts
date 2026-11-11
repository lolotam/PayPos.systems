import { discountApprovalNoticeRequested } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { ApprovalScope } from './discount-approval-notice-data.ts';
import {
  discountApprovalFixture,
  type DiscountApprovalFixture,
} from './discount-approval-notice.fixture.ts';

let f: DiscountApprovalFixture;
beforeAll(async () => {
  f = await discountApprovalFixture();
});
afterAll(async () => {
  await f?.close();
});

it('keeps the 057-3 request bell always on beside the configurable self-approval bell', async () => {
  const scope = await f.otherScope();
  try {
    const approver = await f.user();
    await f.member(approver, 'branch_manager', 'BRANCH', scope.branch);
    await setMaster(scope, false);
    await disableSelfApproval(scope);
    const request = await f.request({ scope, lines: 1 });

    expect(await f.deliver(request.event)).toEqual({ delivered: true });
    expect(await ledger(request.requestId)).toMatchObject([{ recipient_count: 1 }]);
    const rows = await bells(request.requestId);
    expect(rows).toHaveLength(1);
    const payload = discountApprovalNoticeRequested.parse(rows[0]?.['payload']);
    expect(payload.notification_recipients.map((recipient) => recipient.user_id)).toEqual([
      approver,
    ]);
  } finally {
    await cleanup(scope);
  }
});

async function setMaster(scope: ApprovalScope, enabled: boolean | null): Promise<void> {
  await f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${scope.company},${scope.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=${enabled}`;
}

async function disableSelfApproval(scope: ApprovalScope): Promise<void> {
  await f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${scope.company},${f.ids.newId()},${scope.business},NULL,'DISCOUNT_SELF_APPROVED',false,
      ARRAY['owner']::text[],ARRAY['IN_APP']::text[],NULL,NULL,${USER},1)`;
}

function ledger(requestId: string) {
  return f.owner`SELECT recipient_count FROM discount_approval_notices
    WHERE request_id=${requestId} ORDER BY id`;
}

function bells(requestId: string) {
  return f.owner`SELECT payload FROM outbox
    WHERE event_type='DiscountApprovalNoticeRequested' AND payload->>'request_id'=${requestId} ORDER BY seq`;
}

async function cleanup(scope: ApprovalScope): Promise<void> {
  await f.owner`DELETE FROM alert_rules
    WHERE company_id=${scope.company} AND business_id=${scope.business} AND kind='DISCOUNT_SELF_APPROVED'`;
  await f.owner`DELETE FROM business_settings
    WHERE company_id=${scope.company} AND business_id=${scope.business}`;
}
