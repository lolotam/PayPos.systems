import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';
import { isStagingApp } from '@/shared/platform/native-shell';

// الشريط ده بيقول للمستخدم إن التطبيق ده نسخة تجربة: النسخة دي بتتكلم مع سيرفر التجربة
// وبياناتها بيانات اختبار، فالمختبِر لازم ما يخلطهاش بالنسخة الحقيقية (APP-Q13).
export function StagingStrip() {
  const locale = useLocale();
  if (!isStagingApp()) return null;
  return (
    <div role="note" className="w-full bg-[#534AB7] text-center text-xs text-white py-1">
      {t(locale, 'nativeShell.stagingStrip')}
    </div>
  );
}
