import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** عنصر اختبار: صفحة وجهة تأخذ التركيز عند كل مسار جديد، كما تفعل صفحة تحمّلها الوجهة الحقيقية. */
export function Destination() {
  const path = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [path]);
  return (
    <h1 ref={heading} tabIndex={-1}>
      Destination {path}
    </h1>
  );
}
