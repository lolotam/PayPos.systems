import type { ApprovalKindAccess, ApprovalKindId } from '@/staff/api/use-approval-kind-access';

import { NAVIGATION_PAGES, pageEntryHref } from '../navigation-model';
import type { MenuContext } from './menu-context';

export interface ApprovalKindItem {
  id: string;
  label: string;
  href: string;
}

const INBOX_KINDS: readonly string[] = [
  'leave-approvals',
  'attendance-requests',
  'attendance-exceptions',
];

/**
 * أنواع الاعتماد الموجودة اليوم لصندوق الاعتمادات. النوع يظهر فقط إذا كانت صفحته مرئية في القائمة
 * وقراءة الصفحة نفسها نجحت للمستخدم الآن؛ شرط القائمة وحده لا يكفي لأن صفحات الحضور والإجازات
 * تظهر في القائمة دون شرط وتردّ 403 على من لا صلاحية له، فالصندوق لا يربط بصفحة ممنوعة.
 */
export function buildApprovalKinds(
  ctx: MenuContext,
  access: ApprovalKindAccess,
): ApprovalKindItem[] {
  return NAVIGATION_PAGES.filter(
    (entry) =>
      entry.count !== undefined &&
      INBOX_KINDS.includes(entry.count) &&
      ctx.visibleIds.includes(entry.id) &&
      access[entry.count as ApprovalKindId],
  ).map((entry) => ({
    id: entry.id,
    label: ctx.translate(entry.labelKey),
    href: pageEntryHref(entry),
  }));
}
