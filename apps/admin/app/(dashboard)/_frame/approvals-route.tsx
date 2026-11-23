'use client';

import { notFound } from 'next/navigation';

import { ApprovalsInboxPage } from '@/workspace/pages/approvals-inbox-page';

import { useApprovalInbox } from './menu/use-approval-kinds';
import { useVisiblePageIds } from './menu/use-visible-page-ids';

/**
 * صندوق الاعتمادات تحت الرئيسية: الأنواع المسموحة للمستخدم وحال التحقق منها من خطاف القراءة.
 * العنوان المباشر يتبع قاعدة المدخل نفسها (الأدوار الأربعة في القوائم وباحث الصفحات): من خارجها يرى «غير موجود»
 * كما في `/soon/approvals-inbox`. بوابة مساحة العمل تسبق هذه الصفحة، فالدور معروف حين تُرسم.
 */
export function ApprovalsRoute() {
  const visibleIds = useVisiblePageIds();
  const { kinds, state } = useApprovalInbox();
  if (!visibleIds.includes('approvals-inbox')) notFound();
  return <ApprovalsInboxPage kinds={kinds} state={state} />;
}
