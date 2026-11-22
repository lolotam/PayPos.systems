import { id, ownWorkMonth, pageQuery, type StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { z } from 'zod';
import { ApiError } from '../../../shared/errors.ts';
import {
  readCancellations,
  readCustomerNames,
  readLineDetails,
} from './own-service-lines.details.ts';
import { locateOwnLines } from './own-service-lines.membership.ts';
import { pageOwnLines } from './own-service-lines.page.ts';
import { projectOwnLine, type OwnServiceLineItem } from './own-service-lines.projection.ts';
import {
  ownWorkAuthority,
  ownWorkPeriod,
  type OwnWorkBranch,
  type OwnWorkContext,
  type OwnWorkReads,
} from './own-work-context.ts';

// يُستبدل بمخطط العقد عند إضافة المسار (المرحلة 3)؛ نفس الشكل: شهر اختياري، مؤشر line_id، وlimit.
const ownServiceLinesQuery = z.strictObject({
  ...pageQuery.shape,
  month: ownWorkMonth.optional(),
  cursor: id.optional(),
});

export interface OwnServiceLinesPage {
  month: string;
  items: OwnServiceLineItem[];
  next_cursor: string | null;
}

export interface OwnLinesRequest {
  employeeId: string;
  month: string;
  cursor: string | undefined;
  limit: number;
  allowed: ReadonlySet<StaffColumnCode>;
  branches: readonly OwnWorkBranch[];
}

// بعد السلطة: عضوية سطور الموظفة ثم تفاصيل صفحتها فقط، كل جملة على جدول واحد (plan §5.6).
export async function readOwnLinesPage(
  tx: Tx,
  c: OwnWorkContext,
  req: OwnLinesRequest,
): Promise<OwnServiceLinesPage> {
  const owned = await locateOwnLines(tx, c, req.employeeId, req.month, req.allowed.has('share'));
  const page = pageOwnLines(owned.keys, req.cursor, req.limit);
  if (!page) throw new ApiError('VALIDATION_FAILED');
  const lineIds = page.keys.map((key) => key.lineId);
  if (lineIds.length === 0) return { month: req.month, items: [], next_cursor: null };
  const details = await readLineDetails(tx, c, lineIds, req.allowed);
  const cancelled = lineIds.filter((lineId) => details.get(lineId)?.status === 'CANCELLED');
  const sources = {
    details,
    customers: req.allowed.has('customer_name')
      ? await readCustomerNames(tx, c, [...new Set(page.keys.map((key) => key.sessionId))])
      : new Map<string, string>(),
    cancellations:
      cancelled.length > 0 ? await readCancellations(tx, c, cancelled) : new Map<string, string>(),
    shares: owned.shares,
    branches: req.branches,
  };
  return {
    month: req.month,
    items: page.keys.map((key) => projectOwnLine(key, sources, req.allowed)),
    next_cursor: page.nextCursor,
  };
}

// شاشة «شغلي»: السلطة والعضوية والإسقاط داخل لقطة قراءة واحدة (withTenant بخيار readOnly).
export async function readOwnServiceLines(
  tx: Tx,
  c: OwnWorkContext,
  raw: unknown,
  now: Date,
  reads: OwnWorkReads,
): Promise<OwnServiceLinesPage> {
  const live = await ownWorkAuthority(tx, c, raw, now, reads);
  const parsed = ownServiceLinesQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const month = parsed.data.month ?? live.currentMonth;
  const allowed = await ownWorkPeriod(tx, c, month, live.currentMonth, reads);
  return readOwnLinesPage(tx, c, {
    employeeId: live.employeeId,
    month,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
    allowed,
    branches: live.branches,
  });
}
