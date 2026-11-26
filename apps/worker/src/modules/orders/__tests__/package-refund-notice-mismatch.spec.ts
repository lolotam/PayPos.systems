import type { ClaimedEvent } from '@pospay/db';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPackageRefundNoticeConsumer } from '../index.ts';
import {
  packageRefundNoticeFixture,
  type PackageRefundNoticeFixture,
  type SeededRefund,
} from './package-refund-notice.fixture.ts';

let f: PackageRefundNoticeFixture;

beforeAll(async () => {
  f = await packageRefundNoticeFixture();
});

afterAll(async () => {
  await f?.close();
});

function withPayload(seeded: SeededRefund, patch: Record<string, unknown>): ClaimedEvent {
  return {
    ...seeded.event,
    payload: { ...(seeded.event.payload as Record<string, unknown>), ...patch },
  };
}

const mismatchCases: readonly [string, (seeded: SeededRefund) => ClaimedEvent][] = [
  ['wrong companyId (cross-tenant)', (s) => ({ ...s.event, companyId: TENANT.B.company })],
  ['mismatched business_id', (s) => withPayload(s, { business_id: f.ids.newId() })],
  ['mismatched branch_id', (s) => withPayload(s, { branch_id: f.ids.newId() })],
  ['mismatched component_id', (s) => withPayload(s, { component_id: f.ids.newId() })],
  ['mismatched sessions', (s) => withPayload(s, { sessions: 2 })],
  ['mismatched amount', (s) => withPayload(s, { amount: '9.000' })],
  ['mismatched entitlement_revision', (s) => withPayload(s, { entitlement_revision: 9 })],
  ['mismatched refunded_at', (s) => withPayload(s, { refunded_at: '2026-11-21T09:00:00.000Z' })],
  ['mismatched business_date', (s) => withPayload(s, { business_date: '2026-11-21' })],
];

it.each(mismatchCases)(
  'rejects %s and rolls back ledger, outbox and consumed_events',
  async (_name, buildEvent) => {
    const seeded = await f.refund();
    const tampered = buildEvent(seeded);
    const consumer = createPackageRefundNoticeConsumer(f.ids, { now: () => f.at });
    await expect(
      f.db.withTenant(tampered.companyId, (tx) => consumer.handle(tx, tampered)),
    ).rejects.toThrow('PACKAGE_REFUND_EVENT_INVALID');
    expect((await f.deliver(tampered)).delivered).toBe(false);
    expect(await f.notices(seeded.refund)).toHaveLength(0);
    expect(await f.requests(seeded.entitlement)).toHaveLength(0);
    expect(
      await f.owner`SELECT event_id FROM consumed_events WHERE event_id = ${tampered.id}`,
    ).toHaveLength(0);
  },
);

it('records no ledger or notice when the company is closed', async () => {
  const seeded = await f.refund();
  await f.owner`UPDATE companies SET deleted_at = ${f.at} WHERE id = ${f.companyId}`;
  try {
    expect(await f.deliver(seeded.event)).toEqual({ delivered: true });
    expect(await f.notices(seeded.refund)).toHaveLength(0);
    expect(await f.requests(seeded.entitlement)).toHaveLength(0);
  } finally {
    await f.owner`UPDATE companies SET deleted_at = NULL WHERE id = ${f.companyId}`;
  }
});
