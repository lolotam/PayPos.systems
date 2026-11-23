'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useSyncExternalStore } from 'react';

function subscribeToHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  window.addEventListener('popstate', callback);
  return () => {
    window.removeEventListener('hashchange', callback);
    window.removeEventListener('popstate', callback);
  };
}

/**
 * مفتاح الانتقال لإغلاق الطبقات العابرة (قوائم الحساب والمساحة والورقة السفلية واللوحة الطافية والدرج والباحث):
 * المسار مع النص الاستعلامي والجزء (#). صفحة مثل الحزم تدفع `?package=` دون تغيير المسار، والرجوع بين `/staff`
 * و`/staff#pending` لا يغيّر المسار ولا الاستعلام، وكلاهما يجب أن يغلق القائمة المفتوحة. الجزء لا يصل إلى
 * `usePathname` ولا `useSearchParams` فيُقرأ من `window.location` ويُتابَع بحدثي `hashchange` و`popstate`، وهو فارغ
 * على الخادم. كلها طبقات حاجبة أو تُغلق بالضغط خارجها، فتغيّر الرابط بين فتحها وإغلاقها لا يكون بتفاعل المستخدم
 * مع الصفحة، فلا يُغلق بذلك شيء يستعمله. اللوحة الدائمة على الحاسوب خارج هذا المفتاح.
 */
export function useNavigationKey(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
  return `${pathname}${search === '' ? '' : `?${search}`}${hash}`;
}
