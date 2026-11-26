import { capabilities } from '@/shared/platform/native-shell';
import { WebOnlyNotice } from '@/shared/platform/web-only-notice';

import { BrowserPushControl } from './browser-push-control';

/**
 * زر إشعارات الموبايل في شاشة الموظف: إشعارات المتصفح مش شغالة في نسخة التطبيق الأصلي.
 *
 * البوابة بتتأكد قبل ما الـ hook يتركّب: في نسخة التطبيق الأصلي مفيش Service Worker
 * ولا Web Push، فالمتصفح مش هيدّي إشعار أصلاً والزر هيبقى ديكور (MOB-T06).
 */
export function PushControl({ companyId }: { companyId: string }) {
  if (!capabilities().webPush) return <WebOnlyNotice path="/personal" />;
  return <BrowserPushControl companyId={companyId} />;
}
