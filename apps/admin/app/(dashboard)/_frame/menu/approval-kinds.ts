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
 * أنواع الاعتماد الموجودة اليوم لصندوق الاعتمادات: كل صفحة يحمل مدخلها مصدر عدّاد اعتماد،
 * وتظهر فقط لمن تظهر له صفحتها، فالصندوق لا يكشف نوعًا أخفاه شرط الصفحة نفسها.
 */
export function buildApprovalKinds(ctx: MenuContext): ApprovalKindItem[] {
  return NAVIGATION_PAGES.filter(
    (entry) =>
      entry.count !== undefined &&
      INBOX_KINDS.includes(entry.count) &&
      ctx.visibleIds.includes(entry.id),
  ).map((entry) => ({
    id: entry.id,
    label: ctx.translate(entry.labelKey),
    href: pageEntryHref(entry),
  }));
}
