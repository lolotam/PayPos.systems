import { ownServiceLines, ownServiceLinesQuery, type OwnServiceLine } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import {
  ownWorkAuthority,
  ownWorkPeriod,
  type OwnWorkBranch,
  type OwnWorkContext,
  type OwnWorkReads,
} from './own-work-context.ts';

// شاشة «شغلي»: الإسقاط داخل SQL؛ ترتيب الـcursor يُحل من سطر تملكه الموظفة في نفس الشهر.
export function ownServiceLinesStatement(
  c: OwnWorkContext,
  employeeId: string,
  month: string,
  branches: readonly OwnWorkBranch[],
  allowed: ReadonlySet<string>,
  limit: number,
  cursor?: string,
) {
  const fields = [
    sql`'line_id',sl.id,'branch_name_ar',b.name_ar,'branch_name_en',b.name_en,
    'cancelled',sl.status='CANCELLED'`,
  ];
  const optional = [
    ['date', sql`'date',ss.business_date::text,'late',sl.late`],
    [
      'time',
      sql`'time',to_char(ss.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    ],
    ['service', sql`'service_name_ar',sl.name_ar,'service_name_en',sl.name_en`],
    ['customer_name', sql`'customer_name',ss.customer_name`],
    ['list_price', sql`'list_price',sl.list_price::text`],
    ['discount', sql`'discount',sl.discount::text`],
    ['net', sql`'net',sl.net::text`],
    ['share', sql`'share_bps',lp.share_bps`],
  ] as const;
  for (const [code, field] of optional) if (allowed.has(code)) fields.push(field);
  return sql`WITH anchor AS (
    SELECT s.business_date,s.occurred_at,l.id
    FROM service_lines l JOIN service_sessions s
      ON s.company_id=l.company_id AND s.business_id=l.business_id AND s.id=l.session_id
    JOIN line_performers p ON p.company_id=l.company_id AND p.business_id=l.business_id AND p.line_id=l.id
    WHERE l.company_id=${c.companyId} AND l.business_id=${c.businessId}
      AND p.employee_id=${employeeId} AND l.id=${cursor ?? null}::uuid
      AND s.business_date>=${month + '-01'}::date
      AND s.business_date<(${month + '-01'}::date+interval '1 month')
  ), selected AS (
    SELECT sl.id,ss.business_date,ss.occurred_at,
      jsonb_build_object(${sql.join(fields, sql`,`)}) ||
      CASE WHEN sl.status='CANCELLED' THEN jsonb_build_object('cancelled_at',
        to_char(sc.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE '{}'::jsonb END AS item
    FROM line_performers lp JOIN service_lines sl
      ON sl.company_id=lp.company_id AND sl.business_id=lp.business_id AND sl.id=lp.line_id
    JOIN service_sessions ss ON ss.company_id=sl.company_id AND ss.business_id=sl.business_id AND ss.id=sl.session_id
    JOIN jsonb_to_recordset(${JSON.stringify(branches)}::jsonb) AS b(id uuid,name_ar text,name_en text) ON b.id=ss.branch_id
    LEFT JOIN service_line_cancellations sc ON sc.company_id=sl.company_id AND sc.business_id=sl.business_id AND sc.line_id=sl.id
    WHERE lp.company_id=${c.companyId} AND lp.business_id=${c.businessId} AND lp.employee_id=${employeeId}
      AND ss.business_date>=${month + '-01'}::date
      AND ss.business_date<(${month + '-01'}::date+interval '1 month')
      AND (${cursor ?? null}::uuid IS NULL OR
        (ss.business_date,ss.occurred_at,sl.id)<(SELECT business_date,occurred_at,id FROM anchor))
    ORDER BY ss.business_date DESC,ss.occurred_at DESC,sl.id DESC LIMIT ${limit + 1}
  ) SELECT (${cursor ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM anchor)) AS cursor_valid,
    COALESCE((SELECT jsonb_agg(item ORDER BY business_date DESC,occurred_at DESC,id DESC) FROM selected),'[]'::jsonb) AS items`;
}

export async function readOwnServiceLines(
  tx: Tx,
  c: OwnWorkContext,
  raw: unknown,
  now: Date,
  reads: OwnWorkReads,
) {
  const live = await ownWorkAuthority(tx, c, raw, now, reads);
  const parsed = ownServiceLinesQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const { cursor, limit } = parsed.data;
  const month = parsed.data.month ?? live.currentMonth;
  const allowed = await ownWorkPeriod(tx, c, month, live.currentMonth, reads);
  const rows = await tx.execute<{ cursor_valid: boolean; items: OwnServiceLine[] }>(
    ownServiceLinesStatement(c, live.employeeId, month, live.branches, allowed, limit, cursor),
  );
  const result = rows[0];
  if (!result?.cursor_valid) throw new ApiError('VALIDATION_FAILED');
  const items = result.items.slice(0, limit);
  return ownServiceLines.parse({
    month,
    items,
    next_cursor: result.items.length > limit ? (items.at(-1)?.line_id ?? null) : null,
  });
}
