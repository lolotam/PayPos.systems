'use client';

import { ApprovalsInboxPage } from '@/workspace/pages/approvals-inbox-page';

import { useApprovalInbox } from './menu/use-approval-kinds';

/** صندوق الاعتمادات تحت الرئيسية: الأنواع المسموحة للمستخدم وحال التحقق منها من خطاف القراءة. */
export function ApprovalsRoute() {
  const { kinds, state } = useApprovalInbox();
  return <ApprovalsInboxPage kinds={kinds} state={state} />;
}
