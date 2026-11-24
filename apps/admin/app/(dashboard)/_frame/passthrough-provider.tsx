import type { ReactNode } from 'react';

/** عنصر اختبار: مزوّد يمرّر أبناءه كما هم، بدل مزوّد مساحة العمل الحقيقي الذي يحتاج شبكة. */
export function PassthroughProvider({ children }: { children: ReactNode }) {
  return children;
}
