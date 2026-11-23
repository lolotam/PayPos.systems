'use client';

import { usePathname, useSearchParams } from 'next/navigation';

/**
 * مفتاح الانتقال لإغلاق الطبقات العابرة (قوائم الحساب والمساحة والورقة السفلية واللوحة الطافية والدرج والباحث):
 * المسار مع النص الاستعلامي. صفحة مثل الحزم تدفع `?package=` دون تغيير المسار، والرجوع منها يجب أن يغلق
 * القائمة المفتوحة. كلها طبقات حاجبة أو تُغلق بالضغط خارجها، فتغيّر الرابط بين فتحها وإغلاقها لا يكون
 * بتفاعل المستخدم مع الصفحة، فلا يُغلق بذلك شيء يستعمله. اللوحة الدائمة على الحاسوب خارج هذا المفتاح.
 */
export function useNavigationKey(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search === '' ? pathname : `${pathname}?${search}`;
}
