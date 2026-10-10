import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedAttendanceBreak } from './clock-attendance.fixture.ts';
import { CARD_CODE, clockByCardFixture, type CardFixture } from './clock-by-card.fixture.ts';
import { createAttendanceCorrectionTransactions } from '../persistence/drizzle-attendance-correction-transactions.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';

let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
});
afterAll(async () => {
  await f?.close();
});

async function clock(time: string) {
  f.setNow(new Date(`2026-10-03T${time}:00+03:00`));
  return f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
}

it('BW-08 corrects a persisted return using its break-end snapshot, even after the schedule changes', async () => {
  await seedAttendanceBreak(f, '2026-10-03');
  await clock('08:58');
  await clock('13:00');
  const returned = await clock('14:12');
  await clock('17:00');
  const [stored] =
    await f.owner`SELECT revision,scheduled_start FROM attendance_sessions WHERE id=${returned.session_id}`;
  expect(stored?.scheduled_start).toEqual(new Date('2026-10-03T14:00:00+03:00'));
  await f.owner`UPDATE staff_schedule_shifts SET break_end='14:30',break_ends_at='2026-10-03T14:30:00+03:00'
    WHERE company_id=${f.companyId} AND employee_id=${f.employeeId}`;
  const correct = new CorrectAttendanceUseCase(
    createAttendanceCorrectionTransactions(f.database, f.ids),
    f.clock,
  );
  const actor = () => ({
    companyId: f.companyId,
    businessId: f.businessId,
    userId: f.operatorId,
    sessionId: returned.session_id,
    key: f.ids.newId(),
    fingerprint: 'synthetic-break-correction',
  });
  const first = await correct.execute(actor(), {
    revision: stored?.revision as number,
    reason: 'Synthetic earlier return',
    clock_in: '2026-10-03T14:05:00+03:00',
  });
  expect(first.session.late_minutes).toBe(0);
  const second = await correct.execute(actor(), {
    revision: first.session.revision,
    reason: 'Synthetic corrected return',
    clock_in: '2026-10-03T14:11:00+03:00',
  });
  expect(second.session.late_minutes).toBe(11);
  expect(
    await f.owner`SELECT scheduled_start,late_minutes FROM attendance_sessions WHERE id=${returned.session_id}`,
  ).toMatchObject([{ scheduled_start: stored?.scheduled_start, late_minutes: 11 }]);
});
