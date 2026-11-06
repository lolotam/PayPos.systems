import type { Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RatingScreen } from './rating-screen';

export function RatingSession({ token, locale }: { token: string; locale: Locale }) {
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <RatingScreen token={token} locale={locale} />
    </QueryClientProvider>
  );
}
