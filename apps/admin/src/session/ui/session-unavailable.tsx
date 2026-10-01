import { t } from '@pospay/i18n';

import { readRequestLocale } from '@/shared/locale/request-locale';

export async function SessionUnavailable() {
  const locale = await readRequestLocale();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <p role="alert" className="text-start">
        {t(locale, 'admin.unexpected')}
      </p>
    </main>
  );
}
