import type postgres from 'postgres';

import { DEMO_OPERATOR, demoName, type DemoDependencies, type DemoState } from './demo-data.ts';

/**
 * The reads a demo run reconciles against, as the operator connection (pospay_owner sees every company).
 *
 * @param owner a pospay_owner connection to the development database
 * @returns the operatorId and state readers createDemoData takes
 */
export function demoReads(owner: postgres.Sql): Pick<DemoDependencies, 'operatorId' | 'state'> {
  return {
    operatorId: async () => {
      const [row] = await owner<
        { id: string }[]
      >`SELECT id FROM "user" WHERE email = ${DEMO_OPERATOR}`;
      return row?.id ?? null;
    },
    state: async (operatorId, vertical): Promise<DemoState> => {
      const name = demoName(vertical);
      const [row] = await owner<
        { company_id: string; business_id: string | null; branches: number }[]
      >`
        SELECT c.id AS company_id, b.id AS business_id,
               (SELECT count(*)::int FROM branches br WHERE br.company_id = c.id AND br.business_id = b.id) AS branches
        FROM companies c
        LEFT JOIN businesses b ON b.company_id = c.id AND b.vertical_type = ${vertical} AND b.name_en = ${name}
        WHERE c.owner_user_id = ${operatorId} AND c.name_en = ${name}
        ORDER BY c.created_at LIMIT 1`;
      return {
        companyId: row?.company_id ?? null,
        businessId: row?.business_id ?? null,
        hasBranch: (row?.branches ?? 0) > 0,
      };
    },
  };
}
