'use client';

import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** رسالة خطأ النموذج: بتتعلن كتنبيه، وبتختفي لما مفيش خطأ. */
export function FormErrorAlert({ error }: { error?: MessageKey | undefined }) {
  const locale = useLocale();
  if (!error) return null;
  return (
    <EmptyState
      role="alert"
      tone="danger"
      icon={<CircleAlert />}
      title={t(locale, error)}
      className="p-4"
    />
  );
}
