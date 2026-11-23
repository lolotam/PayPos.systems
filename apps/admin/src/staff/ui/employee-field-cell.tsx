import type { ReactNode } from 'react';

/** عدد أعمدة الحقل على شبكة الـ12: 6 للمتوسط، 4 للقصير، 12 للطويل (design.md §6). */
export type EmployeeFieldSpan = 4 | 6 | 12;

const SPAN_CLASS: Record<EmployeeFieldSpan, string> = {
  4: 'md:col-span-4',
  6: 'md:col-span-6',
  12: '',
};

/**
 * خلية حقل واحدة: التسمية والعنصر ورسالته وحدة واحدة على الشبكة، وتتكدس على الهاتف.
 * خارج الشبكة (الافتراضي) ترجع الأبناء كما هم، فنموذج التعديل المشترك لا يتغير.
 */
export function EmployeeFieldCell({
  grid,
  span,
  children,
}: {
  grid: boolean;
  span: EmployeeFieldSpan;
  children: ReactNode;
}) {
  if (!grid) return <>{children}</>;
  return (
    <div className={`col-span-12 flex min-w-0 flex-col gap-3 ${SPAN_CLASS[span]}`.trim()}>
      {children}
    </div>
  );
}
