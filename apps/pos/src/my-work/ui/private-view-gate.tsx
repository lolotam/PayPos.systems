import type { ReactNode } from 'react';
import { type PrivateViewAccess, usePrivateView } from '../api/use-private-view';
import { PrivateViewPinForm } from './private-view-pin-form';

/**
 * بوابة الشاشة الخاصة: خطوة الـ PIN على جهاز الاستقبال، وبعدها المحتوى بأدوات القراءة.
 * أي شاشة خاصة جديدة (حضوري، كارت التقييم) بتتحط جوّا نفس البوابة بدل ما تعيد النافذة.
 *
 * @param props.mode موبايلها الشخصي أو جهاز الاستقبال
 * @param props.cachePrefix بداية مفاتيح الكاش اللي بتتمسح مع القفل
 * @param props.onLeave بتتنده لما الجلسة تتقفل والشاشة تتقفل كلها
 * @param props.children المحتوى اللي بياخد رقم النافذة ومعالج الرفض
 */
export function PrivateViewGate({
  mode,
  cachePrefix,
  onLeave,
  children,
}: {
  mode: 'personal' | 'reception';
  cachePrefix: readonly unknown[];
  onLeave: () => void;
  children: (access: PrivateViewAccess) => ReactNode;
}) {
  const view = usePrivateView({ mode, cachePrefix, onLeave });
  if (view.verifying) return null;
  if (!view.open)
    return (
      <PrivateViewPinForm problem={view.problem} pending={view.pending} onSubmit={view.submitPin} />
    );
  return <>{children(view.access)}</>;
}
