import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** عنصر اختبار: يعرض المسار الذي يراه الإطار، ويرسم بعده ما تكتبه «الصفحة» في الاختبار. */
export function CurrentRoute({ children }: { children?: ReactNode }) {
  return (
    <>
      <p>Route: {usePathname()}</p>
      {children}
    </>
  );
}
