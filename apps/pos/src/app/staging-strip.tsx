import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';
import { isStagingApp } from '@/shared/platform/native-shell';

// الشريط ده بيقول للمستخدم إن التطبيق ده نسخة تجربة: النسخة دي بتتكلم مع سيرفر التجربة
// وبياناتها بيانات اختبار، فالمختبِر لازم ما يخلطهاش بالنسخة الحقيقية (APP-Q13).
export function StagingStrip() {
  const locale = useLocale();
  if (!isStagingApp()) return null;
  return (
    // لازم يفضل ملزوق في أول الشاشة وانت بتسكرول: هو اللي بيقول للمستخدم إن ده تطبيق
    // التجربة، فوجوده في كل شاشة من شاشات نسخة التجربة شرط (APP-Q13، APP-Q23).
    <div
      role="note"
      className="sticky top-0 z-50 w-full bg-[#534AB7] text-center text-xs text-white py-1"
    >
      {t(locale, 'nativeShell.stagingStrip')}
    </div>
  );
}
