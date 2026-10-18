import type { Tx } from '@pospay/db';
import {
  employeeNumberPage,
  type EmployeeNumberListQuery,
  type EmployeeNumberPage,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { employeeNumberGrantCte, employeeNumberVisible } from './employee-number-list-access.ts';
import { icuNameMatch } from './employee-name-search.ts';

export interface EmployeeNumberSearch {
  text: string;
  number: number | null;
}

type EmployeeNumberRow = {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  business_id: string;
  business_name_ar: string | null;
  business_name_en: string;
  employee_number: number | string | null;
};

// شاشة الأرقام الوظيفية على مستوى الشركة.
export function listEmployeeNumbersStatement(
  companyId: string,
  userId: string,
  query: EmployeeNumberListQuery,
  search: EmployeeNumberSearch | undefined,
) {
  const cursor = query.cursor === undefined ? sql`` : sql`AND e.id > ${query.cursor}`;
  return sql`WITH ${employeeNumberGrantCte(companyId, userId)}
    SELECT e.id AS employee_id, e.name_ar, e.name_en, e.business_id,
      b.name_ar AS business_name_ar, b.name_en AS business_name_en, e.employee_number
    FROM employees e
    JOIN businesses b ON b.company_id = e.company_id AND b.id = e.business_id
    WHERE e.company_id = ${companyId} AND e.deleted_at IS NULL
      AND ${employeeNumberVisible(companyId)}
      ${numberSearchClause(companyId, search)}
      ${cursor}
    ORDER BY e.id LIMIT ${query.limit + 1}`;
}

function numberSearchClause(companyId: string, search: EmployeeNumberSearch | undefined) {
  if (search === undefined) return sql``;
  const nameMatch = icuNameMatch(search.text);
  return search.number === null
    ? sql`AND ${nameMatch}`
    : sql`AND (${nameMatch} OR e.id IN (
        SELECT numbered.id FROM employees numbered
        WHERE numbered.company_id = ${companyId} AND numbered.employee_number = ${search.number}))`;
}

export async function listEmployeeNumbers(
  tx: Tx,
  companyId: string,
  userId: string,
  query: EmployeeNumberListQuery,
  search: EmployeeNumberSearch | undefined,
): Promise<EmployeeNumberPage> {
  const rows = await tx.execute<EmployeeNumberRow>(
    listEmployeeNumbersStatement(companyId, userId, query, search),
  );
  const items = rows.slice(0, query.limit).map(listedRow);
  return employeeNumberPage.parse({
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.employee_id ?? null) : null,
  });
}

function listedRow(row: EmployeeNumberRow) {
  return {
    employee_id: row.employee_id,
    name_ar: row.name_ar,
    name_en: row.name_en,
    business_id: row.business_id,
    business_name_ar: row.business_name_ar,
    business_name_en: row.business_name_en,
    employee_number: listedNumber(row.employee_number),
  };
}

function listedNumber(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}
