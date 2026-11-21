import { SYSTEM_ROLES } from '@pospay/db';
import { commissionCorrectionBlockedNoticeRequested } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { SECOND_REVIEWER } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
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

const bellRows = () =>
  owner`SELECT seq, aggregate_id::text AS aggregate_id, payload FROM outbox
    WHERE company_id=${A.company} AND event_type='CommissionCorrectionBlockedNoticeRequested'
    ORDER BY seq`;

const bellPayloads = async () =>
  (await bellRows()).map((row) => commissionCorrectionBlockedNoticeRequested.parse(row.payload));

it('N3 (CM-54) 250 holders ring three grouped bells of 100, 100 and 50 with the block', async () => {
  const holders = Array.from({ length: 248 }, () => ids.newId());
  await owner.begin(async (tx) => {
    for (const [index, holder] of holders.entries()) {
      await tx`INSERT INTO "user"(id, name, email)
        VALUES (${holder}, ${'Commission holder ' + index}, ${'commission-holder-' + index + '@example.test'})`;
      await tx`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
        VALUES (${A.company}, ${ids.newId()}, ${holder}, ${accountantRole.id}, 'global', 'BUSINESS', ${A.business}, '2026-01-01')`;
    }
  });
  const everyone = [...holders, SECOND_REVIEWER.user, USER].sort();
  const { lateEvent } = await seedSeptemberPlanGap();

  expect(await deliver(CURRENT, lateEvent)).toEqual({ delivered: true });

  expect(await blocks()).toHaveLength(1);
  const payloads = await bellPayloads();
  expect(payloads.map((payload) => payload.group_index)).toEqual([0, 1, 2]);
  expect(payloads.map((payload) => payload.notification_recipients.length)).toEqual([100, 100, 50]);
  const recipients = payloads.flatMap((payload) =>
    payload.notification_recipients.map((recipient) => recipient.user_id),
  );
  expect(recipients).toEqual(everyone);
  for (const payload of payloads) {
    expect(payload.business_id).toBe(A.business);
    expect(payload.source_period).toBe('2026-09');
    expect(payload.notification_recipients.map((recipient) => recipient.user_id)).toEqual(
      [...payload.notification_recipients.map((recipient) => recipient.user_id)].sort(),
    );
  }
  expect(payloads.every((payload) => payload.block_id === payloads[0]?.block_id)).toBe(true);
  const block = (await blocks())[0];
  expect((await bellRows())[0]?.aggregate_id).toBe(block?.id);
}, 120_000);
