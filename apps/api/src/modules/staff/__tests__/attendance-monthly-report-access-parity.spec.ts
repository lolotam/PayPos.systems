import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { attendanceReportScope } from '../persistence/attendance-report-access.adapter.ts';
import { monthlyReportFixture, resetReportReader, scopeReportReader, denyReportBranch, reportHeaders, reportUrl,
  type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

it('shared @Require and protectOwnerAccess path matches the report adapter over the grant matrix', async () => {
  const noGrantRole = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en)
    VALUES(${f.company},${noGrantRole},'synthetic_parity_reader','Synthetic parity reader')`;
  const deviceRole = SYSTEM_ROLES.find((role) => role.code === 'device');
  if (!deviceRole) throw new Error('MISSING_SYNTHETIC_DEVICE_ROLE');
  const matrix = ['role default','personal ALLOW','personal DENY','owner with DENY','expired membership','device role'];
  for (const cell of matrix) {
    await resetReportReader(f);
    if (cell === 'owner with DENY') {
      await denyReportBranch(f);
    } else if (cell === 'device role') {
      await f.h.owner`UPDATE memberships SET role_id=${deviceRole.id},role_owner_key='global'
        WHERE company_id=${f.company} AND id=${f.memberId}`;
    } else {
      await scopeReportReader(f,'COMPANY',f.company);
      if (cell === 'personal ALLOW') {
        await f.h.owner`UPDATE memberships SET role_id=${noGrantRole} WHERE company_id=${f.company} AND id=${f.memberId}`;
        await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
          VALUES(${f.company},${salaryIds.newId()},${f.memberId},'read:attendance:branch','ALLOW','COMPANY',${f.company},'Synthetic parity grant',${f.userId})`;
      } else if (cell === 'personal DENY') {
        await denyReportBranch(f);
      } else if (cell === 'expired membership') {
        await f.h.owner`UPDATE memberships SET starts_at=now()-interval '1 day',ends_at=now()-interval '1 second'
          WHERE company_id=${f.company} AND id=${f.memberId}`;
      }
    }
    const decisions: boolean[] = [];
    for (const branch of [f.branch,f.secondBranch]) {
      const response = await f.h.app.inject({method:'GET',url:reportUrl(f,branch),headers:reportHeaders(f)});
      expect([200,404],cell).toContain(response.statusCode);
      decisions.push(response.statusCode === 200);
    }
    expect(decisions,cell).toEqual(cell === 'personal DENY' ? [true,false] :
      cell === 'expired membership' || cell === 'device role' ? [false,false] : [true,true]);
    for (const [index,branch] of [f.branch,f.secondBranch,'all'].entries()) {
      const result = await f.db.withTenant(f.company,(tx) => attendanceReportScope(tx,f.company,f.userId,f.business,branch,'2026-10'));
      expect(typeof result !== 'string',`${cell}:${branch}`).toBe(index === 2 ? decisions.every(Boolean) : decisions[index]);
    }
  }
});
