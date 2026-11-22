'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';

function sameOriginTarget(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href');
  // الرابط الذي له target أو الذي يشير إلى جزء من الصفحة نفسها (#...) يتولاه المتصفح.
  if (href === null || href.startsWith('#')) return null;
  if (anchor.hasAttribute('target') || anchor.hasAttribute('download')) return null;
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
  return anchor instanceof HTMLAnchorElement ? sameOriginTarget(anchor) : null;
}

/**
 * حدّ تنقّل الإطار: يلفّ كل جزء من قوائم الإطار (الشريط الجانبي والعلوي واللوحة والحبوب والشريط السفلي
 * والباحث وقائمة الحساب). روابط @pospay/ui عناصر <a> عادية، فالضغطة العادية في نفس التبويب داخل هذا
 * الحد تذهب إلى موجّه Next بدل تحميل الصفحة كاملة (وهو يُفقد حالة الإطار مثل طيّ الشريط الجانبي).
 * الضغطة بمفتاح تعديل أو الزر الأوسط أو أصل آخر أو رابط له target أو رابط جزء (#) تبقى للمتصفح.
 * المعالجة على الحد نفسه لا على جذر الإطار: أحداث React تصعد عبر الـ portal، فتشمل ما يرسمه جزء
 * من الإطار في body (الأدراج والورقة السفلية والباحث)، ولا تمسّ رابطًا يرسمه محتوى الصفحة، حتى
 * لو رسمه في portal، لأن مكانه في شجرة React خارج هذا الحد.
 * الضغطة على رابط صفحة المسار الحالي لا تغيّر المسار، فلا تُغلق بها الحالات المرتبطة بمفتاح المسار؛
 * لذلك يستدعي الحد `onCurrentPage` ليغلقها المضيف.
 */
export function FrameChrome({
  children,
  onCurrentPage,
}: {
  children: ReactNode;
  onCurrentPage?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div
      className="contents"
      onClick={(event) => {
        const href = softNavigationTarget(event);
        if (href === null) return;
        event.preventDefault();
        router.push(href);
        if (href.split(/[?#]/, 1)[0] === pathname) onCurrentPage?.();
      }}
    >
      {children}
    </div>
  );
}
