import type { ReactNode } from 'react';

export function AppSidebarContent({
  title,
  header,
  navigation,
  footer,
}: {
  title: string;
  header: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
}) {
  return (
    <>
      <div className="flex shrink-0 flex-col gap-6 border-b border-white/10 p-4">{header}</div>
      <nav aria-label={title} className="flex-1 p-4">
        {navigation}
      </nav>
      <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 p-4">{footer}</div>
    </>
  );
}
