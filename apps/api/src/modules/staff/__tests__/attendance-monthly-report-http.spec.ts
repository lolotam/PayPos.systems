import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { monthlyReportFixture, resetReportReader, scopeReportReader, denyReportBranch, reportHeaders, reportUrl,
  reportSession, reportRoleDefault, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); await reportSession(f); });
beforeEach(async () => { await resetReportReader(f); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
const get = (branch = f.branch, csv = false) => f.h.app.inject({method:'GET',url:reportUrl(f,branch,csv),headers:reportHeaders(f)});

it('AB-Q7 manager A reads A, but B and all return the same NOT_FOUND as an unknown branch on JSON and CSV', async () => {
  await scopeReportReader(f);
  expect((await get()).statusCode).toBe(200);
  for (const csv of [false,true]) {
    const missing = await get(salaryIds.newId(),csv);
    expect(missing.statusCode).toBe(404);
    for (const branch of [f.secondBranch,'all',f.foreignBranch]) {
      const response = await get(branch,csv);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(missing.json());
    }
  }
});
it.each(['owner','general_manager','accountant'])('AB-Q2 %s reads every branch and the one-business all view', async (role) => {
  await reportRoleDefault(f,role);
  expect((await get(f.secondBranch)).statusCode).toBe(200);
  const response = await get('all');
  expect(response.statusCode).toBe(200);
  expect(attendanceMonthlyReport.parse(response.json())).toMatchObject({business_id:f.business,branch_id:'all'});
});
it('AB-Q7 business reader sees all; a branch DENY wins over a non-owner company grant', async () => {
  await scopeReportReader(f,'BUSINESS',f.business);
  expect((await get('all')).statusCode).toBe(200);
  await scopeReportReader(f,'COMPANY',f.company);
  await denyReportBranch(f);
  expect((await get()).statusCode).toBe(200);
  expect((await get(f.secondBranch)).statusCode).toBe(404);
  expect((await get('all')).statusCode).toBe(404);
});
it('canonical owner with a branch DENY gets identical single-branch and all outcomes on JSON and CSV', async () => {
  await denyReportBranch(f);
  for (const csv of [false,true]) {
    expect((await get(f.secondBranch,csv)).statusCode).toBe(200);
    expect((await get('all',csv)).statusCode).toBe(200);
  }
});
it('only month is accepted in query; invalid months and incompatible branch/business are refused', async () => {
  for (const url of [`${reportUrl(f,'all')}&branch_id=all`,
    `${reportUrl(f,'all',true)}&business_id=${f.business}`,
    `${reportUrl(f)}&unexpected=true`,reportUrl(f).replace('2026-10','2026-13'),
    reportUrl(f).replace('2026-10','2026-1')]) {
    expect((await f.h.app.inject({method:'GET',url,headers:reportHeaders(f)})).statusCode).toBe(400);
  }
  const mismatch = await f.h.app.inject({method:'GET',url:reportUrl(f).replace(f.business,f.secondBusiness),headers:reportHeaders(f)});
  expect(mismatch.statusCode).toBe(404);
});
it('foreign business all, missing business and existing unreadable business have identical responses', async () => {
  const ids = [salaryIds.newId(),f.secondBusiness];
  const [foreign] = await f.h.owner`SELECT id FROM businesses WHERE company_id=${f.otherCompany} LIMIT 1`;
  ids.push(String(foreign?.id));
  await scopeReportReader(f);
  const bodies = [];
  for (const business of ids) {
    const url = reportUrl(f,'all').replace(f.business,business);
    const response = await f.h.app.inject({method:'GET',url,headers:reportHeaders(f)});
    expect(response.statusCode).toBe(404);
    bodies.push(response.json());
  }
  expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
});
it('feature disabled is FEATURE_DISABLED after permission, and expired membership cannot read', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature off',${f.userId})`;
  expect((await get()).json()).toMatchObject({code:'FEATURE_DISABLED'});
  for (const csv of [false,true]) expect((await get('all',csv)).json()).toMatchObject({code:'FEATURE_DISABLED'});
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  await f.h.owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=now()-interval '1 second' WHERE company_id=${f.company} AND id=${f.memberId}`;
  for (const csv of [false,true]) {
    const single = await get(f.branch,csv), all = await get('all',csv);
    expect(single.statusCode).toBe(404);
    expect(all.statusCode).toBe(single.statusCode);
    expect(all.json()).toEqual(single.json());
  }
});
it('AB-Q2 a named reader with only a personal ALLOW can read its branch until the grant expires', async () => {
  const role = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en)
    VALUES(${f.company},${role},'synthetic_named_report_reader','Synthetic named reader')`;
  await f.h.owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.company}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${salaryIds.newId()},${f.memberId},'read:attendance:branch','ALLOW','BRANCH',${f.branch},'Synthetic grant',${f.userId})`;
  expect((await get(f.branch.toUpperCase())).statusCode).toBe(200);
  expect((await get(f.secondBranch)).statusCode).toBe(404);
  expect((await get('all')).statusCode).toBe(404);
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${salaryIds.newId()},${f.memberId},'read:attendance:branch','ALLOW','BRANCH',${f.secondBranch},'Synthetic grant',${f.userId})`;
  for (const csv of [false,true]) expect((await get('all',csv)).statusCode).toBe(200);
  await denyReportBranch(f);
  for (const csv of [false,true]) expect((await get('all',csv)).statusCode).toBe(404);
  await f.h.owner`UPDATE permission_overrides SET expires_at=now()-interval '1 second'
    WHERE company_id=${f.company} AND membership_id=${f.memberId} AND permission_code='read:attendance:branch'`;
  expect((await get()).statusCode).toBe(404);
});
it('branch closed 15 November remains in October single and all reports, with authorization on the closed branch', async () => {
  await scopeReportReader(f);
  await reportSession(f,{branch:f.secondBranch});
  await f.h.owner`UPDATE employee_branches SET "to"='2026-11-15' WHERE company_id=${f.company} AND branch_id=${f.secondBranch}`;
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  try {
    expect((await get('all')).statusCode).toBe(404);
    expect((await get(f.secondBranch)).statusCode).toBe(404);
    await resetReportReader(f);
    for (const csv of [false,true]) {
      expect((await get(f.secondBranch,csv)).statusCode).toBe(200);
      expect((await get('all',csv)).statusCode).toBe(200);
    }
    const single = attendanceMonthlyReport.parse((await get(f.secondBranch)).json());
    const all = attendanceMonthlyReport.parse((await get('all')).json());
    expect(single.rows[0]?.worked_minutes).toBe(480);
    expect(all.rows[0]?.worked_minutes).toBe(960);
  } finally {
    await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  }
});

it('a closed branch with October links and no sessions is included and authorized in all', async () => {
  await f.h.owner`DELETE FROM attendance_sessions WHERE company_id=${f.company} AND branch_id=${f.secondBranch}`;
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  try {
    await scopeReportReader(f);
    expect((await get('all')).statusCode).toBe(404);
    await resetReportReader(f);
    const all = attendanceMonthlyReport.parse((await get('all')).json());
    expect(all.rows[0]?.contracted_minutes).toBe(16080);
  } finally {
    await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  }
});

it('single and all JSON/CSV refusals match for no grant, DENY, foreign business, feature off and expired membership', async () => {
  for (const refusal of ['no grant','DENY','foreign business','feature off','expired membership']) {
    await resetReportReader(f);
    if (refusal === 'no grant') {
      await scopeReportReader(f,'BUSINESS',f.secondBusiness);
    } else if (refusal === 'DENY') {
      await scopeReportReader(f,'COMPANY',f.company);
      await denyReportBranch(f,f.branch);
    } else if (refusal === 'feature off') {
      await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
        VALUES(${f.company},'staff',false,'Synthetic feature off',${f.userId})`;
    } else if (refusal === 'expired membership') {
      await f.h.owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=now()-interval '1 second' WHERE company_id=${f.company} AND id=${f.memberId}`;
    }
    for (const csv of [false,true]) {
      const singleUrl = reportUrl(f,refusal === 'foreign business' ? f.foreignBranch : f.branch,csv);
      const [foreign] = await f.h.owner`SELECT id FROM businesses WHERE company_id=${f.otherCompany} LIMIT 1`;
      const allUrl = refusal === 'foreign business' ? reportUrl(f,'all',csv).replace(f.business,String(foreign?.id)) : reportUrl(f,'all',csv);
      const single = await f.h.app.inject({method:'GET',url:singleUrl,headers:reportHeaders(f)});
      const all = await f.h.app.inject({method:'GET',url:allUrl,headers:reportHeaders(f)});
      expect(single.statusCode,refusal).toBe(refusal === 'feature off' ? 403 : 404);
      expect(all.statusCode,refusal).toBe(single.statusCode);
      expect(all.json(),refusal).toEqual(single.json());
    }
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});

it('single and all resolve the session company hint and explicit header with identical precedence', async () => {
  await f.h.owner`UPDATE session SET active_company_id=${f.company} WHERE user_id=${f.userId}`;
  for (const csv of [false,true]) {
    for (const branch of [f.branch,'all']) {
      const response = await f.h.app.inject({method:'GET',url:reportUrl(f,branch,csv),headers:{cookie:f.cookie}});
      expect(response.statusCode).toBe(200);
      const invalid = await f.h.app.inject({method:'GET',url:reportUrl(f,branch,csv),headers:{cookie:f.cookie,'x-company-id':'invalid'}});
      expect(invalid.statusCode).toBe(404);
    }
  }
});
it('revoking the persisted grant refuses the next request and failed CSV reads never audit', async () => {
  await scopeReportReader(f);
  expect((await get()).statusCode).toBe(200);
  await f.h.owner`DELETE FROM role_permissions WHERE role_id=${f.readerRole} AND role_owner_key=${f.company}
    AND permission_code='read:attendance:branch'`;
  const before = await f.h.owner`SELECT id FROM audit_log WHERE action='attendance.report.downloaded'`;
  expect((await get(f.branch,true)).statusCode).toBe(404);
  const after = await f.h.owner`SELECT id FROM audit_log WHERE action='attendance.report.downloaded'`;
  expect(after).toEqual(before);
});
