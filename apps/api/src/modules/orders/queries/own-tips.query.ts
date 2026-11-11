import { ownTips, ownTipsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import {
  ownWorkAuthority,
  ownWorkPeriod,
  type OwnWorkContext,
  type OwnWorkReads,
} from './own-work-context.ts';

// شاشة بقشيشي: صفوف الموظفة فقط في أحدث مراجعة، بلا سقف يسقط فلوس من المجموع.
export function ownTipsStatement(c: OwnWorkContext, employeeId: string, month: string) {
  return sql`SELECT t.method,t.amount::text AS amount
    FROM session_tips t JOIN service_sessions s
      ON s.company_id=t.company_id AND s.business_id=t.business_id AND s.id=t.session_id
    WHERE t.company_id=${c.companyId} AND t.business_id=${c.businessId} AND t.employee_id=${employeeId}
      AND s.business_date>=${month + '-01'}::date
      AND s.business_date<(${month + '-01'}::date+interval '1 month')
      AND t.revision_id=(SELECT r.id FROM session_tip_revisions r
        WHERE r.company_id=t.company_id AND r.business_id=t.business_id AND r.session_id=t.session_id
        ORDER BY r.revision DESC LIMIT 1)`;
}

export async function readOwnTips(
  tx: Tx,
  c: OwnWorkContext,
  raw: unknown,
  now: Date,
  reads: OwnWorkReads,
) {
  const live = await ownWorkAuthority(tx, c, raw, now, reads);
  const parsed = ownTipsQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const month = parsed.data.month ?? live.currentMonth;
  const allowed = await ownWorkPeriod(tx, c, month, live.currentMonth, reads);
  if (!allowed.has('tip')) return ownTips.parse({ month, status: 'HIDDEN' });
  const entries = await tx.execute<{ method: 'CASH' | 'CARD'; amount: string }>(
    ownTipsStatement(c, live.employeeId, month),
  );
  return ownTips.parse({ month, status: 'VISIBLE', ...reads.tipTotals([...entries]) });
}
