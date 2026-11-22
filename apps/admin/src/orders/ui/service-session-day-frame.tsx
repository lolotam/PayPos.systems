'use client';
import { DataTableFrame } from '@pospay/ui';
import type { ReactNode } from 'react';

// كرت واحد ثابت الموضع للتصفية والزيارات وزر «المزيد»؛ الزيارات كروت داخله فالحشوة والفجوة هنا،
// ويتبدّل محتواه فقط (القائمة أو رسالة الرفض) كي لا يُعاد تركيب التصفية ويضيع التركيز.
export function ServiceSessionDayFrame({
  filters,
  footer,
  children,
}: {
  filters: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <DataTableFrame filters={filters} footer={footer}>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </DataTableFrame>
  );
}
