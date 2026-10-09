import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { clockChallenge } from '@pospay/contracts';
import {
  attendanceFixture,
  SYNTHETIC_INSTALLATION,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
import { AttendanceError } from '../use-cases/clock-attendance/clock-attendance.ts';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';

let f: AttendanceFixture;
const url = '/v1/staff/attendance';
const other = { business: '', branch: '', employee: '', binding: '', sibling: '' };
beforeAll(async () => {
  f = await attendanceFixture();
  const ids = () => f.ids.newId();
  Object.assign(other, {
    business: ids(),
    branch: ids(),
    employee: ids(),
    binding: ids(),
    sibling: ids(),
  });
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${other.sibling},${f.businessId},${f.branchId},'Synthetic sibling',${employeeNameMatchKey('Synthetic sibling')},'staff','2026-01-01')`;
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${f.otherCompany},${other.business},'Synthetic other business','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.otherCompany},${other.branch},${other.business},'Synthetic other branch')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${other.employee},${other.business},${other.branch},'Synthetic other staff',${employeeNameMatchKey('Synthetic other staff')},'staff','2026-01-01')`;
  await f.owner`INSERT INTO employee_passkeys(company_id,id,business_id,employee_id,passkey_id,revision,bound_at,bound_by)
    SELECT ${f.otherCompany},${other.binding},${other.business},${other.employee},passkey_id,1,clock_timestamp(),${f.userId}
    FROM employee_passkeys WHERE id=${f.bindingId}`;
});
afterAll(async () => {
  await f?.close();
});

it('a CLOCK_IN challenge is refused with the named error once a session opened meanwhile', async () => {
  const stale = await f.prepare();
  const opened = await (await f.prepare()).execute();
  expect(opened.operation).toBe('CLOCK_IN');
  // خمس دقائق بالضبط تتجاوز dedupe، فالانتقال التالي CLOCK_OUT لا يطابق عملية التحدي.
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${new Date(f.clock.now().getTime() - 300000)} WHERE employee_id=${f.employeeId}`;
  const events = await f.owner`SELECT id FROM outbox WHERE company_id=${f.companyId} ORDER BY id`;
  const failure = await stale.execute().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AttendanceError);
  expect(failure).toMatchObject({ code: 'PASSKEY_INVALID' });
  expect(
    await f.owner`SELECT id,status FROM attendance_sessions WHERE company_id=${f.companyId}`,
  ).toEqual([{ id: opened.session_id, status: 'OPEN' }]);
  expect(await f.owner`SELECT id FROM outbox WHERE company_id=${f.companyId} ORDER BY id`).toEqual(
    events,
  );
});

it('a challenge issued for another employee, another company or another personal session is an unknown challenge', async () => {
  const unknown = await submit(f.headers, await issue(f.headers), f.ids.newId());
  expect(unknown.statusCode).toBe(400);
  expect(unknown.body.code).toBe('PASSKEY_INVALID');
  const sessions = await f.owner`SELECT id,status FROM attendance_sessions ORDER BY id`;
  const sibling = await issue(f.headers);
  await f.owner`UPDATE attendance_clock_challenges SET employee_id=${other.sibling}
    WHERE id=${sibling.challenge.challenge_id}`;
  expect(await submit(f.headers, sibling)).toEqual(unknown);
  const foreign = await issue(f.headers);
  await f.owner`UPDATE attendance_clock_challenges SET company_id=${f.otherCompany},business_id=${other.business},
    employee_id=${other.employee},branch_id=${other.branch},binding_id=${other.binding}
    WHERE id=${foreign.challenge.challenge_id}`;
  expect(await submit(f.headers, foreign)).toEqual(unknown);
  const earlier = await issue(f.headers);
  const next = await f.auth.personal.issue(
    f.userId,
    { purpose: 'STAFF_PERSONAL', companyId: f.companyId, businessId: f.businessId },
    async () => true,
  );
  const rotated = { cookie: next.cookie.split(';')[0] ?? '', origin: personalOrigin };
  expect(await submit(rotated, earlier)).toEqual(unknown);
  expect(await f.owner`SELECT id,status FROM attendance_sessions ORDER BY id`).toEqual(sessions);
});

async function issue(headers: AttendanceFixture['headers']) {
  f.setNow(new Date());
  const scan = f.scan();
  const generated = await f.app.inject({
    method: 'POST',
    url: `${url}/challenge`,
    headers,
    payload: scan,
  });
  expect(generated.statusCode).toBe(200);
  return { scan, challenge: clockChallenge.parse(generated.json()) };
}

async function submit(
  headers: AttendanceFixture['headers'],
  issued: Awaited<ReturnType<typeof issue>>,
  challengeId = issued.challenge.challenge_id,
) {
  const response = await f.app.inject({
    method: 'POST',
    url: `${url}/clock`,
    headers: { ...headers, 'idempotency-key': f.ids.newId() },
    payload: {
      ...issued.scan,
      installation_id: SYNTHETIC_INSTALLATION,
      challenge_id: challengeId,
      response: f.device.assertion(issued.challenge.options.challenge, personalOrigin, 'localhost'),
    },
  });
  return { statusCode: response.statusCode, body: response.json<{ code: string }>() };
}
