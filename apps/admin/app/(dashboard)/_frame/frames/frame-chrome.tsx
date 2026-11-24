'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

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

function prefetchTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const value = sameOriginTarget(anchor);
  if (value === null) return null;
  // الوجهة المسبقة بلا جزء (#...): الجلب يهمّه المسار والاستعلام لا موضع الصفحة داخلها.
  return value.split('#', 1)[0] ?? null;
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
 * والحدّ يسبق (prefetch) وجهة رابط الإطار عند نيّة المستخدم (مرور المؤشر أو التركيز بلوحة المفاتيح
 * أو اللمس)، ولا يكرّر الجلب ما بقي المؤشر على الوجهة نفسها، ويطلب الوجهة بلا جزء (#) منها، لأن
 * روابط الكيت روابط <a> عادية لا يسبقها Next `Link` جلبًا مسبقًا.
 * وتسري على هذا الجلب المسبق استثناءات الضغطة نفسها: أصل آخر أو رابط له target أو download أو
 * رابط جزء (#) أو صفحة المسار الحالي.
 * وتُنسى الوجهة المتذكّرة متى غادر المؤشرُ أو التركيزُ الرابطَ أو تغيّر المسار، فتلتقط نيّةٌ
 * لاحقة الوجهةَ من جديد.
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
  const lastPrefetched = useRef<string | null>(null);
  const prefetch = (target: EventTarget | null) => {
    const href = prefetchTarget(target);
    if (href === null || href === lastPrefetched.current) return;
    if (href.split('?', 1)[0] === pathname) return;
    lastPrefetched.current = href;
    router.prefetch(href);
  };
  const forget = (target: EventTarget | null, next: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    // الانتقال بين أجزاء الرابط نفسه ليس مغادرة.
    if (anchor === null || (next instanceof Node && anchor.contains(next))) return;
    lastPrefetched.current = null;
  };
  useEffect(() => {
    lastPrefetched.current = null;
  }, [pathname]);
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
      onPointerOver={(event) => prefetch(event.target)}
      onFocus={(event) => prefetch(event.target)}
      onTouchStart={(event) => prefetch(event.target)}
      onPointerOut={(event) => forget(event.target, event.relatedTarget)}
      onBlur={(event) => forget(event.target, event.relatedTarget)}
    >
      {children}
    </div>
  );
}
