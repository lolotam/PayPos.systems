'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { ResolvedScopeHint } from '@/orders/model/resolve-scope-hint';

/**
 * بوابة تلميح النطاق: التطابق يرجّع null (يكمل الراووت عادي)، وعدم التطابق يعرض رفضًا واضحًا
 * مع زر تبديل بإرادة المستخدم لاختيار متحقق من قايمة الجلسة — مفيش تفويض من العنوان.
 */
export function CustomerPackagesScopeGate({
  hint,
  onChoose,
}: {
  hint: ResolvedScopeHint;
  onChoose: (choice: NonNullable<ResolvedScopeHint['choice']>) => void;
}) {
  const locale = useLocale();
  const { choice, known } = hint;
  return (
    <section className="grid gap-4 text-start">
      <h1 className="text-lg font-semibold">{t(locale, 'customerPackages.title')}</h1>
      <p role="alert">
        {t(locale, known ? 'customerPackages.scopeRefusal' : 'customerPackages.notAllowed')}
      </p>
      {choice !== null ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (choice === null) return;
            onChoose(choice);
          }}
        >
          {t(locale, 'customerPackages.scopeSwitch')}
        </Button>
      ) : null}
    </section>
  );
}
