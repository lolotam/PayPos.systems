import { ids, must } from './session.fixture.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';
import type { PerformersFixture } from './line-performers.helpers.ts';

export async function redeemedVisit(f: PerformersFixture, sessions = 2) {
  const seeded = await seedPackage(f, { sessions, expiresOn: '2026-10-14' });
  const result = await f.create.execute({
    ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]),
  });
  const line = must(result.session.lines[0]);
  const [redemption] = await f.h.owner`SELECT id,slot_id FROM package_redemptions
    WHERE company_id=${f.company} AND line_id=${line.id}`;
  return { ...seeded, sessionId: result.session.id, lineId: line.id,
    redemptionId: must(redemption)['id'] as string, slotId: must(redemption)['slot_id'] as string };
}

export type RedeemedVisit = Awaited<ReturnType<typeof redeemedVisit>>;

export async function packageState(f: PerformersFixture, visit: RedeemedVisit) {
  const [row] = await f.h.owner`SELECT
    (SELECT to_jsonb(l) || jsonb_build_object('net',l.net::text) FROM service_lines l
      WHERE company_id=${f.company} AND id=${visit.lineId}) AS line,
    (SELECT to_jsonb(r) FROM package_redemptions r WHERE company_id=${f.company} AND id=${visit.redemptionId}) AS redemption,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY ordinal) FROM package_session_slots s
      WHERE company_id=${f.company} AND component_id=${visit.component}) AS slots,
    (SELECT jsonb_agg(to_jsonb(c)) FROM service_line_cancellations c
      WHERE company_id=${f.company} AND line_id=${visit.lineId}) AS cancellations`;
  return must(row);
}

export async function packageEvents(f: PerformersFixture, visit: RedeemedVisit) {
  return f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company}
    AND aggregate_id=${visit.sessionId} AND event_type='ServiceLineChanged' ORDER BY created_at,id`;
}
