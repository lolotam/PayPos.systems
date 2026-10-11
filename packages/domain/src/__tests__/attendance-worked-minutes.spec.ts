import { describe, expect, it } from 'vitest';
import { attendanceDecimalHours, attendanceHoursMinutes, attendanceLateness, workedAttendanceMinutes } from '../attendance-worked-minutes.js';
import type { ReportSession, ReportShift } from '../attendance-report-types.js';

const at = (time: string, date = '2026-10-03') => `${date}T${time}:00.000Z`;
const shift: ReportShift = { working_date: '2026-10-03', starts_at: at('06:00'), ends_at: at('14:00'),
  break_starts_at: at('10:00'), break_ends_at: at('11:00') };
const session = (start = '06:00', end: string | null = '14:00', patch: Partial<ReportSession> = {}): ReportSession => ({
  working_date: '2026-10-03', clock_in: at(start), clock_out: end === null ? null : at(end),
  status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: shift.ends_at,
  clock_out_corrected: false, voided: false, ...patch,
});

describe('workedAttendanceMinutes: BW-Q8, AB-Q6 and excluded sessions', () => {
  it.each([
    ['without clocking out', [session()], 480],
    ['break boundaries included', [session('06:00','10:00'), session('11:00','14:00')], 480],
    ['partial break gap', [session('06:00','10:15'), session('10:45','14:00')], 480],
    ['out before window', [session('06:00','09:59'), session('10:30','14:00')], 449],
    ['back after window', [session('06:00','10:30'), session('11:01','14:00')], 449],
    ['gap outside window', [session('06:00','08:00'), session('08:20','14:00')], 460],
    ['different shift', [session('06:00','10:00'),session('11:00','14:00',{ scheduled_end: at('15:00') })], 420],
    ['MANUAL', [session('06:00','14:00',{ source: 'MANUAL' })], 480],
    ['OPEN', [session('06:00',null,{status: 'OPEN'})], 0],
    ['voided', [session('06:00','14:00',{voided: true})], 0],
    ['MISSED_OUT', [session('06:00','22:00',{status: 'MISSED_OUT'})], 0],
    ['CLOCK_IN correction alone', [session('06:30','22:00',{status: 'MISSED_OUT'})], 0],
    ['CLOCK_OUT correction', [session('06:00','14:00',{status: 'MISSED_OUT',clock_out_corrected: true})], 480],
    ['no credit from OPEN return', [session('06:00','10:00'), session('11:00',null,{status:'OPEN'})], 240],
  ] as const)('%s', (_label, sessions, minutes) => {
    expect(workedAttendanceMinutes(sessions, [shift])).toBe(minutes);
  });
  it('does not invent credit when the schedule shift is absent', () => {
    expect(workedAttendanceMinutes([session('06:00','10:00'), session('11:00','14:00')],[])).toBe(420);
  });
  it('credits each adjacent gap once, sorts input and never mutates it', () => {
    const sessions = [session('10:40','14:00'), session('06:00','10:00'),session('10:10','10:20')];
    const before = sessions.map((entry) => ({...entry}));
    expect(workedAttendanceMinutes(sessions,[shift])).toBe(480);
    expect(sessions).toEqual(before);
  });
  it('counts overnight hours on the clock-in date', () => {
    expect(workedAttendanceMinutes([session('19:00',null,{clock_out:at('03:00','2026-10-04')})],[])).toBe(480);
  });
  it('uses elapsed instants across America/New_York DST, without assuming Kuwait offset', () => {
    expect(workedAttendanceMinutes([session('06:00','14:00',{
      clock_in:'2026-11-01T00:30:00-04:00',clock_out:'2026-11-01T02:30:00-05:00',
    })],[])).toBe(180);
  });
  it('includes stored break-return and MISSED_OUT arrival lateness, excluding open and voided sessions', () => {
    expect(attendanceLateness([session('06:00','10:00',{late_minutes:15}),
      session('11:30','14:00',{late_minutes:30}), session('06:00','14:00',{late_minutes:100,voided:true}),
      session('06:00',null,{late_minutes:100,status:'OPEN'}),
      session('06:00','22:00',{late_minutes:100,status:'MISSED_OUT'})])).toEqual({late_count:3,late_minutes:145});
  });
});

it.each([[0,'0:00','0.00'],[465,'7:45','7.75'],[-465,'-7:45','-7.75'],[1,'0:01','0.02'],
  [-1,'-0:01','-0.02'],[59,'0:59','0.98'],[60,'1:00','1.00'],[13680,'228:00','228.00']])(
  'formats %s minutes without rounding h:mm', (minutes, display, decimal) => {
    expect(attendanceHoursMinutes(Number(minutes))).toBe(display);
    expect(attendanceDecimalHours(Number(minutes))).toBe(decimal);
  });
