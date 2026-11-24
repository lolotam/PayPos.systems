'use client';

import type { ReactNode } from 'react';

/** سطر «تسمية: قيمة» في بيانات الصرف. */
export function StatementPaymentField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
