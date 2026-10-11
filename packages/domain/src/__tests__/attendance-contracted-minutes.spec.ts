import { expect, it } from 'vitest';
import { attendanceContractedMinutes, attendanceLeaveSummary, attendanceMonthDates } from '../attendance-contracted-minutes.js';
import { computeAttendanceMonthlyReport } from '../attendance-monthly-report.js';
import type { ReportBranchInputs, ReportContract, ReportLeave } from '../attendance-report-types.js';

const contract: ReportContract = { hire_date:'2026-01-01',contract_end:null,links:[{from:'2026-01-01',to:null}],
  entries: [...[0,1,2,3,4].map((day) => ({ day,start:'09:00',end:'17:00',break_start:'13:00',break_end:'14:00' })),
    {day:5,start:'09:00',end:'21:00'}] };
const leave = (patch: Partial<ReportLeave> = {}): ReportLeave => ({
  type:'ANNUAL',kind:'FULL_DAY',from:'2026-10-03',to:'2026-10-03',
  starts_at:'2026-10-02T21:00:00Z',ends_at:'2026-10-03T21:00:00Z',...patch,
});
const minutes = (leaves: ReportLeave[], data = contract, timezone = 'Asia/Kuwait') => attendanceContractedMinutes(data,'2026-10',leaves,timezone);

it('DH-Q4 October contracted example includes the break, independent of schedules', () => {
  expect(minutes([])).toBe(13680);
  expect(attendanceContractedMinutes(null,'2026-10',[],'Asia/Kuwait')).toBe(0);
});
it.each(['ANNUAL','SICK','UNPAID','OTHER'] as const)('AB-Q4 subtracts %s full-day leave', (type) => {
  expect(minutes([leave({type})])).toBe(13200);
});
it('full-day leave on a weekday with no default subtracts nothing', () => {
  expect(minutes([leave({from:'2026-10-02',to:'2026-10-02'})])).toBe(13680);
});
it.each([
  ['outside','2026-10-03T02:00:00Z','2026-10-03T05:00:00Z',0],
  ['start overlap','2026-10-03T05:00:00Z','2026-10-03T07:00:00Z',60],
  ['end overlap','2026-10-03T13:00:00Z','2026-10-03T15:00:00Z',60],
  ['inside break','2026-10-03T10:00:00Z','2026-10-03T11:00:00Z',60],
  ['whole default','2026-10-03T05:00:00Z','2026-10-03T15:00:00Z',480],
])('PARTIAL removes only %s overlap', (_label, starts_at, ends_at, removed) => {
  expect(minutes([leave({kind:'PARTIAL',starts_at:String(starts_at),ends_at:String(ends_at)})])).toBe(13680-Number(removed));
});
it('does not subtract overlapping leaves twice or produce negative contracted minutes', () => {
  const partial = leave({kind:'PARTIAL',starts_at:'2026-10-03T06:00:00Z',ends_at:'2026-10-03T08:00:00Z'});
  expect(minutes([partial,partial])).toBe(13560);
  expect(minutes([partial,leave(),leave()])).toBe(13200);
  expect(minutes([leave({from:'2026-01-01',to:'2026-12-31'})])).toBe(0);
});
it('respects inclusive hire/contract bounds and exclusive link end, with current defaults throughout', () => {
  expect(minutes([],{...contract,hire_date:'2026-10-03',contract_end:'2026-10-03'})).toBe(480);
  expect(minutes([],{...contract,links:[{from:'2026-10-03',to:'2026-10-04'}]})).toBe(480);
  expect(minutes([],{...contract,hire_date:'2026-11-01'})).toBe(0);
  expect(minutes([],{...contract,links:[]})).toBe(0);
});
it('an overnight default overlaps leave on the next civil date in Kuwait', () => {
  const overnight = {...contract,entries:[{day:0,start:'22:00',end:'06:00'}]};
  expect(minutes([leave({kind:'PARTIAL',from:'2026-10-04',to:'2026-10-04',
    starts_at:'2026-10-03T23:00:00Z',ends_at:'2026-10-04T02:00:00Z'})],overnight)).toBe(2400-180);
});
it('uses the branch zone for America/New_York partial overlap, not the machine or Kuwait zone', () => {
  expect(minutes([leave({kind:'PARTIAL',starts_at:'2026-10-03T13:00:00Z',ends_at:'2026-10-03T15:00:00Z'})],
    contract,'America/New_York')).toBe(13560);
});
it('enumerates leap February and December calendar months', () => {
  expect(attendanceMonthDates('2028-02')).toHaveLength(29);
  expect(attendanceMonthDates('2026-12').at(-1)?.date).toBe('2026-12-31');
});
it('shows full leave days clipped to month and partial hours independently of default overlap', () => {
  const summary = attendanceLeaveSummary([leave({from:'2026-09-29',to:'2026-10-02'}),
    leave({type:'OTHER',kind:'PARTIAL',starts_at:'2026-10-03T02:00:00Z',ends_at:'2026-10-03T05:00:00Z'})],'2026-10');
  expect(summary).toEqual([{type:'ANNUAL',days:2,partial_minutes:0},{type:'SICK',days:0,partial_minutes:0},
    {type:'UNPAID',days:0,partial_minutes:0},{type:'OTHER',days:0,partial_minutes:180}]);
});
it('sums branches into one employee row and counts distinct days plus manual sessions, with signed difference', () => {
  const branch: ReportBranchInputs = { timezone:'Asia/Kuwait',contract,leave_for_branch:[],shifts:[],sessions:[{
    working_date:'2026-10-03',clock_in:'2026-10-03T06:00:00Z',clock_out:'2026-10-03T08:00:00Z',
    status:'CLOSED',source:'MANUAL',late_minutes:12,scheduled_end:null,clock_out_corrected:false,voided:false,
  }] };
  expect(computeAttendanceMonthlyReport([branch,branch],'2026-10')).toMatchObject({
    days_present:1,worked_minutes:240,scheduled_minutes:0,contracted_minutes:27360,
    difference_minutes:-27120,late_count:2,late_minutes:24,manual_days:2,missing_clock_out:0,
  });
});
it('AB-Q7 sums full and partial leave columns across branches while presence dates remain distinct', () => {
  const branch: ReportBranchInputs = {timezone:'Asia/Kuwait',contract:null,shifts:[],sessions:[],
    leave_for_branch:[leave(),leave({type:'SICK',kind:'PARTIAL',starts_at:'2026-10-03T06:00:00Z',ends_at:'2026-10-03T07:00:00Z'})]};
  expect(computeAttendanceMonthlyReport([branch,branch],'2026-10').leave).toMatchObject([
    {type:'ANNUAL',days:2,partial_minutes:0},{type:'SICK',days:0,partial_minutes:120},
    {type:'UNPAID',days:0,partial_minutes:0},{type:'OTHER',days:0,partial_minutes:0},
  ]);
});

function reemBranches(leaves: ReportLeave[]): ReportBranchInputs[] {
  return [{day:0,start:'09:00',end:'17:00'},{day:0,start:'18:00',end:'22:00'}].map((entry) => ({
    timezone:'Asia/Kuwait',sessions:[],shifts:[],leave_for_branch:leaves,
    contract:{...contract,entries:[entry]},
  }));
}
it.each([
  ['FULL_DAY',leave(),[480,240,720]],
  ['PARTIAL',leave({kind:'PARTIAL',starts_at:'2026-10-03T07:00:00Z',ends_at:'2026-10-03T09:00:00Z'}),[120,0,120]],
] as const)('AB-Q11 Reem %s leave removes each linked branch default overlap and sums all branches', (_kind, approved, removed) => {
  const baseline = reemBranches([]), branches = reemBranches([approved]);
  for (let index = 0; index < 2; index++) {
    expect(computeAttendanceMonthlyReport(baseline.slice(index,index+1),'2026-10').contracted_minutes -
      computeAttendanceMonthlyReport(branches.slice(index,index+1),'2026-10').contracted_minutes).toBe(removed[index]);
  }
  expect(computeAttendanceMonthlyReport(baseline,'2026-10').contracted_minutes -
    computeAttendanceMonthlyReport(branches,'2026-10').contracted_minutes).toBe(removed[2]);
});
it('AB-Q11 leave at another branch removes nothing outside this branch link dates', () => {
  const [branch] = reemBranches([leave()]);
  if (!branch?.contract) throw new Error('MISSING_SYNTHETIC_CONTRACT');
  branch.contract = {...branch.contract,links:[{from:'2026-10-04',to:null}]};
  expect(computeAttendanceMonthlyReport([branch],'2026-10').contracted_minutes).toBe(1920);
});
