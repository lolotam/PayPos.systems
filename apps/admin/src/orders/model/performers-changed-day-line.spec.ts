import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { applyPerformersChangedLine } from './performers-changed-day-line';
import { id, instant, savedLine } from './session-recording-result.fixture';

type Line = DayPage['items'][number]['lines'][number];
const flags = { not_clocked_in_warning: false, approved_leave_warning: false };
const cached: Line = {
  id: id(20),
  service_id: id(5),
  ordinal: 1,
  name_en: 'Colour',
  name_ar: null,
  status: 'ACTIVE',
  revision: 5,
  edited: false,
  late: false,
  list_price: '60.000',
  price: '60.000',
  discount: '0.000',
  net: '60.000',
  effective_discount_bps: 0,
  recorded_by: id(4),
  recorded_at: instant,
  has_performer_warning: false,
  performers_changed_at: '2026-10-21',
  performers: [{ employee_id: id(9), name_en: 'Rana', name_ar: null, share_bps: 10000, ...flags }],
};
const replay = {
  ...savedLine,
  id: id(20),
  status: 'ACTIVE' as const,
  revision: 4,
  performers_changed_at: '2026-10-20',
};

it('keeps a newer cached line when an older response is replayed', () => {
  expect(applyPerformersChangedLine(cached, replay)).toBe(cached);
});

it('applies the response performers, revision and mark when it is current or newer', () => {
  const next = applyPerformersChangedLine({ ...cached, revision: 3 }, replay);
  expect(next.revision).toBe(4);
  expect(next.performers_changed_at).toBe('2026-10-20');
  expect(next.performers.map((row) => [row.employee_id, row.share_bps])).toEqual(
    savedLine.performers.map((row) => [row.employee_id, row.share_bps]),
  );
  expect(next.price).toBe('60.000');
  expect(applyPerformersChangedLine({ ...cached, revision: 4 }, replay).revision).toBe(4);
});
