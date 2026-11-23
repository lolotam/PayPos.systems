import { ApprovalsInboxPage } from '@/workspace/pages/approvals-inbox-page';

import { useApprovalInbox } from './use-approval-kinds';

/** عنصر اختبار: صندوق الاعتمادات كما ستركّبه 7b، من خطاف القراءة إلى الصفحة. */
export function ApprovalsInboxHost() {
  const { kinds, state } = useApprovalInbox();
  return <ApprovalsInboxPage kinds={kinds} state={state} />;
}
