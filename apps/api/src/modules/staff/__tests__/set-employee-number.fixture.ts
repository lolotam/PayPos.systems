import {
  assignFixture,
  employeeNumberIds,
  executeCreate,
  grantEmployeeCreation,
  type EmployeeFixture,
} from './employee-number-assign.fixture.ts';

export { executeCreate };
export async function numberFixture() {
  const f = await assignFixture();
  await grantEmployeeCreation(f);
  await grantEmployeeCreation(f, f.secondBusiness);
  return f;
}

export async function putNumber(
  f: EmployeeFixture,
  employeeId: string,
  body: object,
  options: { cookie?: string; businessId?: string } = {},
) {
  const businessId = options.businessId ?? f.business;
  const response = await f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${businessId}/employees/${employeeId}/employee-number`,
    headers: {
      cookie: options.cookie ?? f.cookie,
      'x-company-id': f.company,
      origin: 'http://admin.test',
    },
    payload: body,
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export function numberAudits(f: EmployeeFixture, employeeId: string) {
  return f.h.owner`SELECT before, after FROM audit_log
    WHERE company_id=${f.company} AND entity='employees' AND action='employee_number.changed' AND entity_id=${employeeId}`;
}

export async function grantNumber(
  f: EmployeeFixture,
  effect: 'ALLOW' | 'DENY',
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
) {
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${employeeNumberIds.newId()},${f.memberId},'manage:employee-number:company',${effect},${scopeType},${scopeId},'Synthetic grant',${f.userId})`;
}

export async function clearNumberGrants(f: EmployeeFixture) {
  await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND permission_code='manage:employee-number:company'`;
}

export async function attachBranch(f: EmployeeFixture, employeeId: string, businessId = f.business) {
  const branchId = employeeNumberIds.newId();
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${f.company},${branchId},${businessId},'Synthetic attached')`;
  await f.h.owner`INSERT INTO employee_branches (company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${f.company},${employeeNumberIds.newId()},${businessId},${employeeId},${branchId},'2020-01-01')`;
  return branchId;
}

export async function numberDevice(f: EmployeeFixture) {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expectStatus(code.status, 201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic number refusal' },
  });
  expectStatus(registered.statusCode, 201);
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expectStatus(approved.status, 204);
  const claimed = await f.h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expectStatus(claimed.statusCode, 200);
  return claimed.json<{ device_token: string }>().device_token;
}

function expectStatus(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`SYNTHETIC_DEVICE_SETUP_FAILED_${actual}`);
}
