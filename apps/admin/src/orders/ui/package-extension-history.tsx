'use client';
import type { CustomerPackageExtension } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

function historyRow(template: string, extension: CustomerPackageExtension) {
  const [before = '', rest = ''] = template.split('{from}');
  const [middle = '', after = ''] = rest.split('{to}');
  return (
    <>
      {before}
      <bdi dir="ltr">{extension.previous_expires_on}</bdi>
      {middle}
      <bdi dir="ltr">{extension.new_expires_on}</bdi>
      {after}
    </>
  );
}

export function PackageExtensionHistory({
  extensions,
}: {
  extensions: readonly CustomerPackageExtension[];
}) {
  const locale = useLocale();
  return (
    <section className="grid gap-2 text-start" aria-label={t(locale, 'packageExtension.historyTitle')}>
      <h3 className="font-semibold">{t(locale, 'packageExtension.historyTitle')}</h3>
      {extensions.length === 0 ? (
        <p role="status">{t(locale, 'packageExtension.historyEmpty')}</p>
      ) : (
        <ol className="grid gap-2 ps-4">
          {extensions.map((extension) => (
            <li key={extension.id} className="grid gap-1">
              <span>{historyRow(t(locale, 'packageExtension.historyRow'), extension)}</span>
              <span>
                {t(locale, 'packageExtension.historyRowTime').replace('{at}', '')}
                <bdi dir="ltr">{extension.extended_at}</bdi>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
