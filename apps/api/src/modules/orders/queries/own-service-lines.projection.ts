import type { OwnServiceLine, StaffColumnCode } from '@pospay/contracts';
import type { OwnLineDetail } from './own-service-lines.details.ts';
import type { OwnLineKey } from './own-service-lines.page.ts';
import type { OwnWorkBranch } from './own-work-context.ts';

export interface OwnLineSources {
  details: ReadonlyMap<string, OwnLineDetail>;
  customers: ReadonlyMap<string, string>;
  cancellations: ReadonlyMap<string, string>;
  shares: ReadonlyMap<string, number>;
  branches: readonly OwnWorkBranch[];
}

/**
 * يركب سطر «شغلي» واحداً من مصادره؛ لا يضيف مفتاحاً لعمود غير مسموح، و`late` يسافر مع `date` فقط.
 * `time` يقطع مفتاح الميكروثانية إلى ميلي ثانية بصيغة timestamp.
 *
 * @param key مفتاح السطر من مجموعة الموظفة
 * @param src نتائج القراءات الأحادية للصفحة
 * @param allowed أكواد الأعمدة المسموحة
 * @returns السطر بمفاتيحه المسموحة
 */
export function projectOwnLine(
  key: OwnLineKey,
  src: OwnLineSources,
  allowed: ReadonlySet<StaffColumnCode>,
): OwnServiceLine {
  const detail = src.details.get(key.lineId);
  const branch = src.branches.find((b) => b.id === key.branchId);
  if (!detail || !branch) throw new Error('Own service line source is missing for a member line');
  const cancelledAt = src.cancellations.get(key.lineId);
  const item: OwnServiceLine = {
    line_id: key.lineId,
    branch_name_ar: branch.name_ar,
    branch_name_en: branch.name_en,
    cancelled: detail.status === 'CANCELLED',
    ...(detail.status === 'CANCELLED' && cancelledAt !== undefined
      ? { cancelled_at: cancelledAt }
      : {}),
  };
  if (allowed.has('date')) {
    item.date = key.businessDate;
    if (detail.late !== undefined) item.late = detail.late;
  }
  if (allowed.has('time')) item.time = `${key.occurredAt.slice(0, 23)}Z`;
  if (allowed.has('service')) {
    if (detail.name_ar !== undefined) item.service_name_ar = detail.name_ar;
    if (detail.name_en !== undefined) item.service_name_en = detail.name_en;
  }
  const customer = src.customers.get(key.sessionId);
  if (allowed.has('customer_name') && customer !== undefined) item.customer_name = customer;
  if (detail.list_price !== undefined) item.list_price = detail.list_price;
  if (detail.discount !== undefined) item.discount = detail.discount;
  if (detail.net !== undefined) item.net = detail.net;
  const share = src.shares.get(key.lineId);
  if (allowed.has('share') && share !== undefined) item.share_bps = share;
  return item;
}
