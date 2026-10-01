import type { ReactNode } from 'react';

import { DocumentShell } from '@/shared/locale/document-shell';

export function Providers({ children }: { children: ReactNode }) {
  return <DocumentShell>{children}</DocumentShell>;
}
