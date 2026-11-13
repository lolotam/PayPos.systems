import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from '@pospay/db';

import type {
  CoverageProjectionReader,
  SalaryCoverageRow,
  ServiceLineCoverageRow,
} from '../ports/commission-coverage.port.ts';

function uuidArray(ids: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

export function projectedLineRevisionsStatement(
  companyId: string,
  lineIds: readonly string[],
): SQL {
  return sql`
    SELECT line_id, revision::int AS revision FROM commission_line_heads
     WHERE company_id = ${companyId}
       AND line_id = ANY(${uuidArray(lineIds)})`;
}

export function projectedSalaryRevisionsStatement(
  companyId: string,
  employeeIds: readonly string[],
): SQL {
  return sql`
    SELECT employee_id, effective_from::text AS effective_from, revision::int AS revision
      FROM commission_salaries
     WHERE company_id = ${companyId}
       AND employee_id = ANY(${uuidArray(employeeIds)})`;
}

export function markedEventIdsStatement(
  companyId: string,
  consumerId: string,
  eventIds: readonly string[],
): SQL {
  return sql`
    SELECT event_id FROM consumed_events
     WHERE company_id = ${companyId}
       AND consumer_id = ${consumerId}
       AND event_id = ANY(${uuidArray(eventIds)})`;
}

export function createCoverageProjectionReader(): CoverageProjectionReader {
  return {
    lineRevisions: async (
      tx: Tx,
      companyId: string,
      lineIds: readonly string[],
    ): Promise<readonly ServiceLineCoverageRow[]> => {
      if (lineIds.length === 0) return [];
      const rows = await tx.execute<{ line_id: string; revision: number }>(
        projectedLineRevisionsStatement(companyId, lineIds),
      );
      return rows.map((row) => ({ lineId: row.line_id, revision: row.revision }));
    },
    salaryRevisions: async (
      tx: Tx,
      companyId: string,
      employeeIds: readonly string[],
    ): Promise<readonly SalaryCoverageRow[]> => {
      if (employeeIds.length === 0) return [];
      const rows = await tx.execute<{
        employee_id: string;
        effective_from: string;
        revision: number;
      }>(projectedSalaryRevisionsStatement(companyId, employeeIds));
      return rows.map((row) => ({
        employeeId: row.employee_id,
        effectiveFrom: row.effective_from,
        revision: row.revision,
      }));
    },
    markedEventIds: async (
      tx: Tx,
      companyId: string,
      consumerId: string,
      eventIds: readonly string[],
    ): Promise<ReadonlySet<string>> => {
      if (eventIds.length === 0) return new Set<string>();
      const rows = await tx.execute<{ event_id: string }>(
        markedEventIdsStatement(companyId, consumerId, eventIds),
      );
      return new Set(rows.map((row) => row.event_id.toLowerCase()));
    },
  };
}
