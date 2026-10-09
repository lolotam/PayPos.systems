import { sql } from 'drizzle-orm';
import { OWNER_ROLE_ID } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeIban, employeeIbanStatement } from '../queries/employee-iban.query.ts';
import {
  employeeIbanHistory,
  employeeIbanHistoryStatement,
} from '../queries/employee-iban-history.query.ts';
import { duplicateEmployeeIbanStatement } from '../persistence/drizzle-employee-iban-transactions.ts';
import { createEmployeeIbanAccess } from '../persistence/employee-iban-access.adapter.ts';
import {
  employeeIbanFixture,
  generatedIban,
  ibanHttp,
  ibanIds,
  ibanTerms,
  type IbanFixture,
} from './employee-iban.fixture.ts';
let f: IbanFixture;
beforeAll(async () => {
  f = await employeeIbanFixture();
  await f.setIban.execute({ ...f.context, input: ibanTerms() });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it.each(['primary', 'open'] as const)(
  'masks with business ALLOW but returns 404 with DENY on the persisted %s branch',
  async (scope) => {
    const branchId = scope === 'primary' ? f.branch : ibanIds.newId();
    if (scope === 'open') {
      await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
        VALUES (${f.company},${branchId},${f.business},'Synthetic additional branch')`;
      await f.h
        .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
        VALUES (${f.company},${ibanIds.newId()},${f.business},${f.employee.id},${branchId},'2026-01-01')`;
    }
    const [role] = await f.h.owner`SELECT id FROM roles
      WHERE company_id=${f.company} AND code='synthetic_employee_editor'`;
    const denyId = ibanIds.newId();
    try {
      await f.h
        .owner`UPDATE memberships SET role_id=${role?.['id'] as string},role_owner_key=${f.company}
        WHERE company_id=${f.company} AND id=${f.memberId}`;
      const allowed = await ibanHttp(f, 'GET');
      expect(allowed.status).toBe(200);
      expect(allowed.body).toMatchObject({ can_read_full: false, iban_last4: '0101', iban: null });
      await f.h
        .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES (${f.company},${denyId},${f.memberId},'manage:employees:business','DENY','BRANCH',${branchId},'Synthetic deny',${f.userId})`;
      const denied = await ibanHttp(f, 'GET');
      expect(denied.status).toBe(404);
      expect(denied.body['code']).toBe('NOT_FOUND');
    } finally {
      await f.h
        .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${denyId}`;
      await f.h.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global'
        WHERE company_id=${f.company} AND id=${f.memberId}`;
    }
  },
);
it('returns exact full shape and a masked query that never selects protected columns', async () => {
  const full = await f.db.withTenant(f.company, (tx) =>
    employeeIban(tx, f.context, createEmployeeIbanAccess()),
  );
  expect(full).toEqual({
    iban: ibanTerms().iban,
    bank_id: ibanTerms().bank_id,
    holder_name_en: ibanTerms().holder_name_en,
    status: 'SET',
    iban_last4: '0101',
    revision: 1,
    set_at: expect.any(String),
    set_by: f.userId,
    can_read_full: true,
    can_manage: true,
  });
  const masked = await f.db.withTenant(f.company, (tx) =>
    employeeIban(tx, f.context, {
      check: async () => ({ read: false, manage: false, masked: true, featureEnabled: true }),
    }),
  );
  expect(masked).toEqual({
    status: 'SET',
    iban_last4: '0101',
    iban: null,
    bank_id: null,
    holder_name_en: null,
    revision: 1,
    set_at: expect.any(String),
    set_by: null,
    can_read_full: false,
    can_manage: false,
  });
  const query = new PgDialect().sqlToQuery(employeeIbanStatement(f.context, false)).sql;
  expect(query).not.toMatch(/bank_id|holder_name_en|set_by/);
  expect(query.match(/iban/g)).toHaveLength(3);
});
it('history projects full values newest first with a revision cursor', async () => {
  await f.setIban.execute({ ...f.context, input: ibanTerms(generatedIban(22), 1) });
  const page = await f.db.withTenant(f.company, (tx) =>
    employeeIbanHistory(tx, f.context, { limit: 1 }, createEmployeeIbanAccess()),
  );
  expect(page).toMatchObject({
    items: [
      {
        revision: 2,
        iban: generatedIban(22),
        bank_id: 'kw-cbk',
        holder_name_en: 'SYNTHETIC HOLDER',
        cleared: false,
        set_by: f.userId,
        reason: 'Synthetic change',
      },
    ],
    next_cursor: 2,
  });
});
it('current, history and duplicate lookups use the indexes introduced with this slice', async () => {
  const statements = [
    employeeIbanStatement(f.context, true),
    employeeIbanHistoryStatement(f.context, { limit: 20, cursor: 3 }),
    duplicateEmployeeIbanStatement(f.context, generatedIban(22)),
  ];
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const results = [];
    for (const statement of statements)
      results.push(
        JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`)),
      );
    return results;
  });
  expect(plans[0]).toContain('employee_ibans_employee_revision_key');
  expect(plans[1]).toContain('employee_ibans_employee_revision_key');
  expect(plans[2]).toContain('employee_ibans_company_iban_idx');
});
