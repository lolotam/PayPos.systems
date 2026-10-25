import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface ActiveLineRead {
  readonly lineId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly businessTimezone: string;
  readonly performers: { employeeId: string; shareBps: number }[];
}

type ActiveLineRow = {
  readonly line_id: string;
  readonly session_id: string;
  readonly branch_id: string;
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly business_timezone: string;
  readonly employee_id: string;
  readonly share_bps: number;
};

function instant(value: Date | string): Date {
  return new Date(value instanceof Date ? value.getTime() : value);
}

// حالة يوم جدولة التقييم تقرأ البنود النشطة ومنفذيها من أوامر الخدمة (FR-B06).
export function activeLinesOfCustomerStatement(
  companyId: string,
  businessId: string,
  customerId: string,
  fromInstant: Date,
  toInstant: Date,
): SQL {
  const from = fromInstant.toISOString();
  const to = toInstant.toISOString();
  return sql`SELECT l.id AS line_id, s.id AS session_id, s.branch_id,
      s.occurred_at, s.recorded_at, s.business_timezone, p.employee_id, p.share_bps
    FROM service_sessions s
    JOIN service_lines l ON l.company_id = s.company_id AND l.business_id = s.business_id
      AND l.session_id = s.id AND l.status = 'ACTIVE'
    JOIN line_performers p ON p.company_id = l.company_id AND p.business_id = l.business_id
      AND p.line_id = l.id
    WHERE s.company_id = ${companyId} AND s.company_id = app_company_id()
      AND s.business_id = ${businessId} AND s.customer_id = ${customerId}
      AND s.occurred_at >= ${from}::timestamptz AND s.occurred_at < ${to}::timestamptz
      AND s.business_date BETWEEN (${from}::date - 1) AND (${to}::date + 1)
    ORDER BY s.occurred_at, s.id, l.ordinal, p.performer_ordinal`;
}

export async function listActiveLinesOfCustomer(
  tx: Tx,
  companyId: string,
  businessId: string,
  customerId: string,
  fromInstant: Date,
  toInstant: Date,
): Promise<ActiveLineRead[]> {
  const rows = await tx.execute<ActiveLineRow>(
    activeLinesOfCustomerStatement(companyId, businessId, customerId, fromInstant, toInstant),
  );
  const lines = new Map<string, ActiveLineRead>();
  for (const row of rows) {
    let line = lines.get(row.line_id);
    if (line === undefined) {
      line = {
        lineId: row.line_id,
        sessionId: row.session_id,
        branchId: row.branch_id,
        occurredAt: instant(row.occurred_at),
        recordedAt: instant(row.recorded_at),
        businessTimezone: row.business_timezone,
        performers: [],
      };
      lines.set(row.line_id, line);
    }
    line.performers.push({ employeeId: row.employee_id, shareBps: row.share_bps });
  }
  return [...lines.values()];
}
