'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

/** علامة المناطق التي هي تنقّل الإطار حتى لو وقعت داخل <main> (مثل حبوب النمط A فوق المحتوى). */
const FRAME_CHROME_ATTRIBUTE = 'data-frame-chrome';

function isPageContent(anchor: Element): boolean {
  return anchor.closest('main') !== null && anchor.closest(`[${FRAME_CHROME_ATTRIBUTE}]`) === null;
}

function sameOriginTarget(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href');
  const sameTab = anchor.target === '' || anchor.target === '_self';
  if (href === null || !sameTab || anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  // المقارنة على الأصل بعد التحليل: «//host» و«/\host» يقرؤهما المتصفح كمضيف آخر.
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
}

function softNavigationTarget(event: MouseEvent<HTMLElement>): string | null {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (event.defaultPrevented || event.button !== 0 || modified) return null;
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || isPageContent(anchor)) return null;
  return sameOriginTarget(anchor);
}

/**
 * روابط القوائم في @pospay/ui عناصر <a> عادية، فهذا المحوّل ينقل الضغطة العادية في نفس التبويب
 * إلى موجّه Next بدل تحميل الصفحة كاملة (وهو يُفقد حالة الإطار مثل طيّ الشريط الجانبي).
 * الضغطة بمفتاح تعديل أو الزر الأوسط تبقى للمتصفح، وروابط محتوى الصفحة داخل <main> لا تُمس إلا
 * ما وُسم بـ data-frame-chrome. المعالجة على الجذر فتشمل القوائم المرسومة في portal أيضًا.
 */
export function FrameLinks({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
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
