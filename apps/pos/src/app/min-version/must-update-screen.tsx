import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { AppFrame } from '@/shared/frame/app-frame';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

import { isAllowedStoreUrl } from './version-compare';

/**
 * شاشة «لازم تحدّث»: بتغطي كل شاشات نسخة التطبيق، ومفيش زرار بيقفلها (FR-006).
 *
 * زرار المتجر بيظهر بس لو لينك المتجر على مضيف مسموح (FR-008)؛ أي لينك تاني
 * بيخلي الشاشة تقفل وتقول للمستخدم يحدّث من المتجر.
 *
 * @param props.storeUrl لينك المتجر من ملف النسخة
 */
export function MustUpdateScreen({ storeUrl }: { storeUrl: string }) {
  const locale = useLocale();
  return (
    <AppFrame brand={t(locale, 'pos.appName')} actions={<LocaleSwitch />}>
      <section className="mx-auto grid w-full max-w-md gap-6 landscape:max-w-3xl">
        <h1 className="text-2xl font-semibold">{t(locale, 'nativeShell.mustUpdateTitle')}</h1>
        <p className="text-muted-foreground">{t(locale, 'nativeShell.mustUpdateLead')}</p>
        {isAllowedStoreUrl(storeUrl) ? (
          <Button asChild size="touch">
            <a href={storeUrl} target="_blank" rel="noopener noreferrer">
              {t(locale, 'nativeShell.mustUpdateButton')}
            </a>
          </Button>
        ) : (
          <p>{t(locale, 'nativeShell.mustUpdateFallback')}</p>
        )}
      </section>
    </AppFrame>
  );
}
