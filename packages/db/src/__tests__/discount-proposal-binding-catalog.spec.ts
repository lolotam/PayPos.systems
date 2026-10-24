import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase, owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

it('binds the three constraints: two deferred to the commit and one immediate', async () => {
  const rows = await owner<
    {
      conname: string;
      convalidated: boolean;
      condeferrable: boolean;
      condeferred: boolean;
      definition: string;
    }[]
  >`SELECT conname,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname IN ('service_lines_discount_proposal_binding_fk','dp_consumed_line_session_fk','dp_session_branch_fk')
    ORDER BY conname`;
  expect(rows).toEqual([
    {
      conname: 'dp_consumed_line_session_fk',
      convalidated: true,
      condeferrable: true,
      condeferred: true,
      definition:
        'FOREIGN KEY (company_id, consumed_line_id, session_id) REFERENCES service_lines(company_id, id, session_id) DEFERRABLE INITIALLY DEFERRED',
    },
    {
      conname: 'dp_session_branch_fk',
      convalidated: true,
      condeferrable: false,
      condeferred: false,
      definition:
        'FOREIGN KEY (company_id, branch_id, session_id) REFERENCES service_sessions(company_id, branch_id, id)',
    },
    {
      conname: 'service_lines_discount_proposal_binding_fk',
      convalidated: true,
      condeferrable: true,
      condeferred: true,
      definition:
        'FOREIGN KEY (company_id, discount_proposal_id, id, business_id, service_id) REFERENCES discount_proposals(company_id, id, consumed_line_id, business_id, service_id) DEFERRABLE INITIALLY DEFERRED',
    },
  ]);
});

// المفاتيح دي أساس القيود، والفهرس بيخدم بحث القيد الفوري على فرع الزيارة، فأي هجرة بعدين بتمسح واحد منهم أو تعيد بناؤه لازم تفشل هنا.
it('pins the unique keys and the branch index the binding migrations build', async () => {
  const keys = await owner<
    { conname: string; contype: string; convalidated: boolean }[]
  >`SELECT c.conname,
    c.contype, c.convalidated
    FROM pg_constraint c
    WHERE c.conname IN ('service_lines_id_session_key','service_sessions_branch_id_key','dp_consumed_line_binding_key')
    ORDER BY c.conname`;
  expect(keys).toEqual([
    { conname: 'dp_consumed_line_binding_key', contype: 'u', convalidated: true },
    { conname: 'service_lines_id_session_key', contype: 'u', convalidated: true },
    { conname: 'service_sessions_branch_id_key', contype: 'u', convalidated: true },
  ]);
  const indexes = await owner<
    { name: string; valid: boolean; definition: string }[]
  >`SELECT ic.relname AS name,
    i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relname IN ('service_lines_id_session_key','service_sessions_branch_id_key','dp_consumed_line_binding_key','dp_session_branch_fk_idx')
    ORDER BY ic.relname`;
  expect(indexes).toEqual([
    {
      name: 'dp_consumed_line_binding_key',
      valid: true,
      definition:
        'CREATE UNIQUE INDEX dp_consumed_line_binding_key ON public.discount_proposals USING btree (company_id, id, consumed_line_id, business_id, service_id)',
    },
    {
      name: 'dp_session_branch_fk_idx',
      valid: true,
      definition:
        'CREATE INDEX dp_session_branch_fk_idx ON public.discount_proposals USING btree (company_id, branch_id, session_id) WHERE (session_id IS NOT NULL)',
    },
    {
      name: 'service_lines_id_session_key',
      valid: true,
      definition:
        'CREATE UNIQUE INDEX service_lines_id_session_key ON public.service_lines USING btree (company_id, id, session_id)',
    },
    {
      name: 'service_sessions_branch_id_key',
      valid: true,
      definition:
        'CREATE UNIQUE INDEX service_sessions_branch_id_key ON public.service_sessions USING btree (company_id, branch_id, id)',
    },
  ]);
});
