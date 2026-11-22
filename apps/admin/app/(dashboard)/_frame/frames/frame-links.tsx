'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

function softNavigationTarget(event: MouseEvent<HTMLElement>): string | null {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (event.defaultPrevented || event.button !== 0 || modified) return null;
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || anchor.closest('main') !== null) return null;
  const href = anchor.getAttribute('href');
  const sameTab = anchor.target === '' || anchor.target === '_self';
  if (href === null || !href.startsWith('/') || href.startsWith('//')) return null;
  return sameTab && !anchor.hasAttribute('download') ? href : null;
}

/**
 * روابط القوائم في @pospay/ui عناصر <a> عادية، فهذا المحوّل ينقل الضغطة العادية في نفس التبويب
 * إلى موجّه Next بدل تحميل الصفحة كاملة. الضغطة بمفتاح تعديل أو الزر الأوسط تبقى للمتصفح،
 * وروابط المحتوى داخل <main> لا تُمس. المعالجة على الجذر فتشمل القوائم المرسومة في portal أيضًا.
 */
export function FrameLinks({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- الجذر لا يتفاعل بنفسه، يلتقط ضغطات الروابط التي بداخله فقط.
    <div
      className="contents"
      onClick={(event) => {
        const href = softNavigationTarget(event);
        if (href === null) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      {children}
    </div>
  );
}
