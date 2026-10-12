import { attendanceBoardFixture } from './attendance-board.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

export async function attendanceEmployeesFixture() {
  const f = await attendanceBoardFixture();
  const cases = [
    { key: 'current', name: 'Picker Alpha', ar: 'اختيار ألف', from: '2026-01-01', to: null },
    { key: 'future', name: 'Picker Beta', ar: null, from: '2027-01-01', to: null },
    {
      key: 'futureEnd',
      name: 'Picker Beta',
      ar: 'اختيار باء',
      from: '2027-01-01',
      to: '2028-01-01',
    },
    {
      key: 'endsLater',
      name: 'Picker Delta',
      ar: 'اختيار دال',
      from: '2026-01-01',
      to: '2026-10-06',
    },
    { key: 'endsToday', name: 'Picker Today', ar: null, from: '2026-01-01', to: '2026-10-05' },
    { key: 'ended', name: 'Picker Ended', ar: null, from: '2026-01-01', to: '2026-10-04' },
    { key: 'deleted', name: 'Picker Deleted', ar: null, from: '2026-01-01', to: null },
    { key: 'other', name: 'Picker Other', ar: null, from: '2026-01-01', to: null },
    { key: 'unlinked', name: 'Picker Unlinked', ar: null, from: '2026-01-01', to: null },
    { key: 'literal', name: 'Picker | "100%_"', ar: null, from: '2026-01-01', to: null },
  ];
  const employees = [];
  for (const entry of cases) {
    const employee = { id: leaveIds.newId(), name_en: entry.name, name_ar: entry.ar };
    await f.h
      .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,deleted_at)
      VALUES(${f.company},${employee.id},${f.business},${entry.key === 'unlinked' ? f.branch : f.secondBranch},
        ${employee.name_ar},${employee.name_en},${employee.name_en.toLowerCase()},'staff','2026-01-01',${entry.key === 'deleted' ? new Date('2026-10-04') : null})`;
    if (entry.key !== 'unlinked')
      await f.h
        .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
        VALUES(${f.company},${leaveIds.newId()},${f.business},${employee.id},${entry.key === 'other' ? f.secondBranch : f.branch},${entry.from},${entry.to})`;
    employees.push({ ...employee, key: entry.key });
  }
  const current = employees.find((e) => e.key === 'current');
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-06'
    WHERE company_id=${f.company} AND employee_id=${current?.id as string}`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${current?.id as string},${f.branch},'2026-10-06')`;
  const included = employees.filter((e) =>
    ['current', 'endsLater', 'literal'].includes(e.key),
  );
  const expected = included.map(({ id, name_ar, name_en }) => ({ id, name_ar, name_en }));
  return { ...f, pickerEmployees: employees, expected };
}
export type AttendanceEmployeesFixture = Awaited<ReturnType<typeof attendanceEmployeesFixture>>;
