import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createGate,
  waitForBlockedAppSession,
} from '../../../../../../packages/db/test/rating-concurrency-fixtures.ts';
import type { DiscountSelfApprovalNoticeEvent } from '../ports/discount-self-approval-notice.port.ts';
import { discountSelfApprovalRepository } from '../persistence/discount-self-approval-notice.repository.ts';
import type { PreparedSelfApproval } from './discount-self-approval-notice-data.ts';
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

const ROLLBACK = 'synthetic first claim rollback';

it('deliverer dedupe lets two simultaneous deliveries resolve with one ledger row and bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  const outcomes = await Promise.all([f.deliver(prepared.event), f.deliver(prepared.event)]);
  expect(outcomes.map((outcome) => outcome.delivered)).toEqual([true, true]);
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
  expect(await f.bells(prepared.event.id)).toHaveLength(1);
}, 60_000);

it('direct consumer races bypass consumed events but still claim one ledger row and bell', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  await Promise.all([f.consume(prepared.event), f.consume(prepared.event)]);
  expect(await f.notices(prepared.event.id)).toHaveLength(1);
  expect(await f.bells(prepared.event.id)).toHaveLength(1);
}, 60_000);

it('a committed first claim makes the waiting connection lose without inserting its id', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  const race = await raceClaims(prepared, false);
  expect(race.firstWon).toBe(true);
  expect(race.secondWon).toBe(false);
  const rows = await f.notices(prepared.event.id);
  expect(rows).toMatchObject([{ id: race.firstId }]);
  expect(rows.map((row) => row['id'])).not.toContain(race.secondId);
}, 60_000);

it('rolling back the first claim lets the waiting connection win with its own id', async () => {
  const scope = await f.otherScope();
  const prepared = await f.selfApproval({ scope });
  const race = await raceClaims(prepared, true);
  expect(race.firstWon).toBeUndefined();
  expect(race.secondWon).toBe(true);
  const rows = await f.notices(prepared.event.id);
  expect(rows).toMatchObject([{ id: race.secondId }]);
  expect(rows.map((row) => row['id'])).not.toContain(race.firstId);
}, 60_000);

async function raceClaims(prepared: PreparedSelfApproval, rollbackFirst: boolean) {
  const event = f.noticeEvent(prepared);
  const firstId = f.ids.newId();
  const secondId = f.ids.newId();
  const claimed = createGate();
  const release = createGate();
  const first = f.db.withTenant(event.companyId, async (tx) => {
    const won = await discountSelfApprovalRepository(tx).claim(event, decision(event, firstId));
    claimed.open();
    await release.opened;
    if (rollbackFirst) throw new Error(ROLLBACK);
    return won;
  });
  // لو رفض الأول قبل الإعلان فالانتظار على البوابة وحدها يعلق للمهلة؛ السباق يكشف الفشل فوراً.
  await Promise.race([claimed.opened, first]);
  const second = f.db.withTenant(event.companyId, (tx) =>
    discountSelfApprovalRepository(tx).claim(event, decision(event, secondId)),
  );
  let firstWon: boolean | undefined;
  try {
    try {
      await waitForBlockedAppSession(f.owner);
    } finally {
      release.open();
    }
    if (rollbackFirst) await expect(first).rejects.toThrow(ROLLBACK);
    else firstWon = await first;
    return { firstId, secondId, firstWon, secondWon: await second };
  } finally {
    release.open();
    await Promise.allSettled([first, second]);
  }
}

function decision(event: DiscountSelfApprovalNoticeEvent, id: string) {
  return { id, sourceEventId: event.sourceEventId, decidedAt: f.at, recipientCount: 1 };
}
