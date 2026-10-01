import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader } from '@pospay/ui';

export function GuestFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-start text-lg font-bold leading-tight">{title}</h1>
          <p className="text-start text-sm text-muted-foreground">{lead}</p>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
