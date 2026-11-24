import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approvalFootprint,
  approveReviewedMonth,
  approverMember,
  resetCoverage,
  type Approver,
} from './approve-statement.fixture.ts';
import { ids, statementFixture, type StatementFixture } from './commission-statement.fixture.ts';

// CM-34c: شهر بلا أي نشاط يُجمَّد بصف EMPLOYEE واحد بمبلغ صفر لكل موظفة في النطاق ولا شيء غيره، وموظفة عُيّنت بعده لا تظهر.
// أكتوبر خالٍ في الـfixture (بنود نوفمبر فقط)، والموظفتان معيّنتان من 2026-01-01، وثالثة تُعيَّن في 10 نوفمبر.
const EMPTY_MONTH = '2026-10';

let f: StatementFixture;
let approver: Approver;
let hiredLater = '';

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'empty-month-approver');
  hiredLater = ids.newId();
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${f.company},${hiredLater},${f.business},${f.branch},'Hired Later',
      ${employeeNameMatchKey('Hired Later')},'staff','2026-11-10',50)`;
});

afterAll(async () => {
  await f?.h.close();
});

describe('approving a month with no activity (CM-34c)', () => {
  it('freezes one zero EMPLOYEE row per employee in scope and nothing else, leaving out an employee hired later', async () => {
    await resetCoverage(f);

    const { response } = await approveReviewedMonth(f, approver, 'empty-month', EMPTY_MONTH);

    expect(response.status).toBe(200);
    const frozen = await f.h.owner`SELECT employee_id, kind, amount::text AS amount
      FROM commission_statement_lines l JOIN commission_statements s ON s.id = l.statement_id
      WHERE s.company_id = ${f.company} AND s.period = ${EMPTY_MONTH} ORDER BY employee_id`;
    expect(frozen.map((row) => row['kind'])).toEqual(['EMPLOYEE', 'EMPLOYEE']);
    expect(frozen.map((row) => row['amount'])).toEqual(['0.000', '0.000']);
    expect(frozen.map((row) => row['employee_id']).sort()).toEqual([f.employee, f.secondEmployee].sort());
    expect(frozen.map((row) => row['employee_id'])).not.toContain(hiredLater);
    expect(await approvalFootprint(f, EMPTY_MONTH)).toMatchObject({
      status: 'APPROVED',
      audits: 1,
      carries: 0,
    });
  });
});
