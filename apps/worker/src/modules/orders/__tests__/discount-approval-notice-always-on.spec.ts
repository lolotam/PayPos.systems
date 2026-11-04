import { discountApprovalNoticeRequested } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
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

// DA-Q11: جرس «طلب الموافقة» شغال دايمًا تحت «قفل كل التنبيهات»؛ لا AlertRulesPort عند مستهلك 057-3 ولا يُضاف.
it('the request bell stays always-on: master switch off and a stored rule still ring every eligible approver', async () => {
  await f.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES(${f.tenant.company},${f.tenant.business},false)
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=false`;
  await f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
      delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${f.tenant.company},${f.ids.newId()},${f.tenant.business},NULL,'DISCOUNT_SELF_APPROVED',false,
      ARRAY['owner']::text[],ARRAY['IN_APP']::text[],NULL,NULL,${USER},1)`;
  try {
    const approver = await f.user();
    await f.member(approver, 'branch_manager', 'BRANCH', f.tenant.branch);
    const request = await f.request({ lines: 1 });
    expect(await f.deliver(request.event)).toEqual({ delivered: true });
    expect(await f.notices(request.requestId)).toMatchObject([{ recipient_count: 1 }]);
    const rows = await f.requests(request.requestId);
    expect(rows).toHaveLength(1);
    expect(
      discountApprovalNoticeRequested.parse(rows[0]?.['payload']).notification_recipients.map(
        (recipient) => recipient.user_id,
      ),
    ).toEqual([approver]);
  } finally {
    await f.owner`UPDATE business_settings SET alerts_enabled=NULL
      WHERE company_id=${f.tenant.company} AND business_id=${f.tenant.business}`;
    await f.owner`DELETE FROM alert_rules
      WHERE company_id=${f.tenant.company} AND business_id=${f.tenant.business} AND kind='DISCOUNT_SELF_APPROVED'`;
  }
});
