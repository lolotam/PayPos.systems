import { t } from '@pospay/i18n';
import { EmptyState, CircleAlert } from '@pospay/ui';

import { readRequestLocale } from '@/shared/locale/request-locale';

export async function SessionUnavailable() {
  const locale = await readRequestLocale();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={t(locale, 'admin.unexpected')}
      />
    </main>
  );
}
