import type { ReactNode } from 'react';

export function AppFrame({
  brand,
  selector,
  actions,
  children,
}: {
  brand: ReactNode;
  selector?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <p className="text-start font-medium">{brand}</p>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          {selector}
          {actions}
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
