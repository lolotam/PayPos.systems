'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, Inbox, LoaderCircle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function RatingsNotice({
  kind,
  message,
}: {
  kind: 'loading' | 'error' | 'empty';
  message?: string;
}) {
  const locale = useLocale();
  if (kind === 'loading')
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  if (kind === 'error')
    return <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={message} />;
  return <EmptyState icon={<Inbox />} title={message} />;
}
