import { SYSTEM_ROLES } from '@pospay/db';
import { commissionCorrectionBlockedNoticeRequested } from '@pospay/contracts';
import { expect, it } from 'vitest';

import {
  OTHER_COMMISSION_IDS,
  SECOND_REVIEWER,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  A,
  blocks,
  CURRENT,
  deliver,
  ids,
  owner,
  seedSeptemberPlanGap,
} from './commission-blocked-corrections-db.fixture.ts';

const accountantRole = SYSTEM_ROLES.find((role) => role.code === 'accountant');
if (accountantRole === undefined) throw new Error('the accountant role is missing');

const bellRecipients = async (): Promise<readonly string[]> => {
  const [row] = await owner`SELECT payload FROM outbox
    WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'`;
  const payload = commissionCorrectionBlockedNoticeRequested.parse(row?.payload);
  return payload.notification_recipients.map((recipient) => recipient.user_id);
};

it('N9 a denied holder and a holder scoped to another business are not recipients', async () => {
  const denied = ids.newId();
  const elsewhere = ids.newId();
  await owner`INSERT INTO "user"(id, name, email)
    VALUES (${denied}, 'Denied holder', 'denied-holder@example.test'),
      (${elsewhere}, 'Elsewhere holder', 'elsewhere-holder@example.test')`;
  const deniedMembership = ids.newId();
  const elsewhereMembership = ids.newId();
  await owner`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${A.company}, ${deniedMembership}, ${denied}, ${accountantRole.id}, 'global', 'BUSINESS', ${A.business}, '2026-01-01'),
      (${A.company}, ${elsewhereMembership}, ${elsewhere}, ${accountantRole.id}, 'global', 'BUSINESS', ${OTHER_COMMISSION_IDS.business}, '2026-01-01')`;
  await owner`INSERT INTO permission_overrides(company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
    VALUES (${A.company}, ${ids.newId()}, ${deniedMembership}, 'manage:commission-plans:business', 'DENY', 'BUSINESS', ${A.business}, 'منع صريح للاختبار', ${USER})`;

  const { lateEvent } = await seedSeptemberPlanGap();
  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await blocks()).toHaveLength(1);
  expect(await bellRecipients()).toEqual([SECOND_REVIEWER.user, USER].sort());
});

it('N6 (Q7) no holder keeps the block with no bell at all', async () => {
  // حذف العضويات أو تغيير نطاقها بيرفضه قيد «الشركة لازم تفضل فيها مالك»،
  // فبنشيل صفوف المنحة العالمية للصلاحية نفسها: مالكتها كمان محتاجة ALLOW عشان تعتبر حاملة.
  await owner`DELETE FROM permission_overrides WHERE company_id=${A.company}`;
  await owner`DELETE FROM role_permissions WHERE permission_code='manage:commission-plans:business'`;
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await blocks()).toMatchObject([
    { source_period: '2026-09', code: 'NO_PLAN', resolved_at: null },
  ]);
  expect(
    await owner`SELECT id FROM outbox
      WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'`,
  ).toEqual([]);
});
