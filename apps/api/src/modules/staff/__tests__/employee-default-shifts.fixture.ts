import type { ScheduleShift } from '@pospay/contracts';
import { salaryFixture, salaryIds } from './salary.fixture.ts';
import { createEmployeeDefaultShiftsTransactions } from '../persistence/employee-default-shifts.adapter.ts';
import { SetEmployeeDefaultShiftsUseCase } from '../use-cases/set-employee-default-shifts/set-employee-default-shifts.usecase.ts';

export const defaultHoursClock = { now: () => new Date('2026-10-11T10:00:00Z') };
export const salmiyaDefaults: ScheduleShift[] = [0, 1, 2, 3, 4].map((day) => ({
  day, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00',
}));
salmiyaDefaults.push({ day: 5, start: '09:00', end: '21:00', break_start: '14:00', break_end: '15:00' });

export async function defaultHoursFixture() {
  const f = await salaryFixture();
  const secondBranch = salaryIds.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${secondBranch},${f.business},'Synthetic Hawalli')`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.employee.id},${secondBranch},'2026-01-01')`;
  const setHours = new SetEmployeeDefaultShiftsUseCase(
    createEmployeeDefaultShiftsTransactions(f.db, salaryIds), defaultHoursClock,
  );
  const path = `/v1/businesses/${f.business}/employees/${f.employee.id}/default-shifts`;
  const putPath = (branch = f.branch) =>
    `/v1/businesses/${f.business}/employees/${f.employee.id}/branches/${branch}/default-shifts`;
  return { ...f, secondBranch, setHours, hoursPath: path, putPath };
}
export type DefaultHoursFixture = Awaited<ReturnType<typeof defaultHoursFixture>>;
export function hoursCommand(f: DefaultHoursFixture, shifts = salmiyaDefaults, branchId = f.branch) {
  return { ...f.context, branchId, input: { shifts } };
}
export async function hoursHttp(f: DefaultHoursFixture, method: 'GET' | 'PUT', path: string, payload?: object) {
  const response = await f.h.app.inject({ method, url: path,
    headers: { cookie: f.cookie, 'x-company-id': f.company, origin: 'http://admin.test' },
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export async function hoursDevice(f: DefaultHoursFixture) {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie, company: f.company,
  });
  expectStatus(code.status, 201);
  const registered = await f.h.app.inject({ method: 'POST', url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic hours refusal' } });
  expectStatus(registered.statusCode, 201);
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie: f.cookie, company: f.company,
  });
  expectStatus(approved.status, 204);
  const claimed = await f.h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expectStatus(claimed.statusCode, 200);
  return claimed.json<{ device_token: string }>().device_token;
}
function expectStatus(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`SYNTHETIC_DEVICE_SETUP_FAILED_${actual}`);
}
