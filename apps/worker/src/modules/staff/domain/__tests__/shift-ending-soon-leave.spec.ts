import { describe, expect, it } from 'vitest';
import { endsSoonLeave, type ShiftEndSpan } from '../shift-ending-soon.ts';
import type { LeaveInterval } from '../not-clocked-in.ts';

// مونا 10:00–18:00 بتوقيت الكويت (UTC+3)، والوردية متخزّنة 07:00Z–15:00Z.
const utc = (iso: string) => new Date(iso);
const SHIFT: ShiftEndSpan = {
  workingDate: '2026-10-04',
  startsAt: utc('2026-10-04T07:00:00.000Z'),
  endsAt: utc('2026-10-04T15:00:00.000Z'),
};

function leave(patch: Partial<LeaveInterval> = {}): LeaveInterval {
  return {
    status: 'APPROVED',
    kind: 'FULL_DAY',
    from: '2026-10-04',
    to: '2026-10-04',
    startsAt: utc('2026-10-04T00:00:00.000Z'),
    endsAt: utc('2026-10-04T23:59:00.000Z'),
    ...patch,
  };
}

describe('endsSoonLeave full-day leave', () => {
  it('excuses an approved full-day leave that covers the working date', () => {
    expect(endsSoonLeave(SHIFT, [leave()])).toBe(true);
  });

  it('does not excuse a full-day leave on another date', () => {
    expect(endsSoonLeave(SHIFT, [leave({ from: '2026-10-06', to: '2026-10-06' })])).toBe(false);
  });

  it('does not excuse a full-day leave that ended the day before or starts the day after', () => {
    expect(endsSoonLeave(SHIFT, [leave({ from: '2026-10-02', to: '2026-10-03' })])).toBe(false);
    expect(endsSoonLeave(SHIFT, [leave({ from: '2026-10-05', to: '2026-10-06' })])).toBe(false);
  });

  it('excuses an overnight shift whose working date is the last day of the leave', () => {
    const overnight: ShiftEndSpan = {
      workingDate: '2026-10-04',
      startsAt: utc('2026-10-04T19:00:00.000Z'),
      endsAt: utc('2026-10-05T03:00:00.000Z'),
    };
    expect(endsSoonLeave(overnight, [leave({ from: '2026-10-03', to: '2026-10-04' })])).toBe(true);
  });
});

describe('endsSoonLeave partial leave', () => {
  it('excuses an approved partial leave that ends exactly with the shift', () => {
    const partial = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T13:00:00.000Z'),
      endsAt: utc('2026-10-04T15:00:00.000Z'),
    });
    expect(endsSoonLeave(SHIFT, [partial])).toBe(true);
  });

  it('excuses an approved partial leave that passes the shift end', () => {
    const partial = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T13:00:00.000Z'),
      endsAt: utc('2026-10-04T16:00:00.000Z'),
    });
    expect(endsSoonLeave(SHIFT, [partial])).toBe(true);
  });

  it('does not excuse a partial leave that ends just before the shift end', () => {
    const partial = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T13:00:00.000Z'),
      endsAt: utc('2026-10-04T14:59:59.999Z'),
    });
    expect(endsSoonLeave(SHIFT, [partial])).toBe(false);
  });

  it('does not excuse a partial leave in the middle of the shift', () => {
    const partial = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T10:00:00.000Z'),
      endsAt: utc('2026-10-04T11:00:00.000Z'),
    });
    expect(endsSoonLeave(SHIFT, [partial])).toBe(false);
  });

  it('does not excuse a partial leave that starts at the shift end', () => {
    const partial = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T15:00:00.000Z'),
      endsAt: utc('2026-10-04T16:00:00.000Z'),
    });
    expect(endsSoonLeave(SHIFT, [partial])).toBe(false);
  });
});

describe('endsSoonLeave statuses and several leaves', () => {
  it('never excuses a pending, rejected or cancelled leave, of either kind', () => {
    for (const status of ['PENDING', 'REJECTED', 'CANCELLED']) {
      expect(endsSoonLeave(SHIFT, [leave({ status })])).toBe(false);
      const partial = leave({
        status,
        kind: 'PARTIAL',
        startsAt: utc('2026-10-04T13:00:00.000Z'),
        endsAt: utc('2026-10-04T16:00:00.000Z'),
      });
      expect(endsSoonLeave(SHIFT, [partial])).toBe(false);
    }
  });

  it('does not excuse anything without a leave', () => {
    expect(endsSoonLeave(SHIFT, [])).toBe(false);
  });

  it('excuses the shift when one of several leaves qualifies', () => {
    const pending = leave({ status: 'PENDING' });
    const elsewhere = leave({ from: '2026-10-06', to: '2026-10-06' });
    const qualifying = leave({
      kind: 'PARTIAL',
      startsAt: utc('2026-10-04T13:00:00.000Z'),
      endsAt: utc('2026-10-04T16:00:00.000Z'),
    });
    expect(endsSoonLeave(SHIFT, [pending, elsewhere, qualifying])).toBe(true);
    expect(endsSoonLeave(SHIFT, [pending, elsewhere])).toBe(false);
  });
});
