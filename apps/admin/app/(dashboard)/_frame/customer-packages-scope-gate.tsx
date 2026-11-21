'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { WorkspaceCompany } from '@pospay/contracts';
import { resolveScopeHint, type ScopeHint } from '@/orders/model/resolve-scope-hint';

/**
 * بوابة تلميح النطاق: التطابق يرجّع null (يكمل الراووت عادي)، وعدم التطابق يعرض رفضًا واضحًا
 * مع زر تبديل بإرادة المستخدم لاختيار متحقق من قايمة الجلسة — مفيش تفويض من العنوان.
 */
export function CustomerPackagesScopeGate({
  companies,
  current,
  hint,
  onChoose,
}: {
  companies: readonly WorkspaceCompany[];
  current: { company: string; business: string; branch: string };
  hint: ScopeHint;
  onChoose: (choice: { companyId: string; businessId: string; branchId: string }) => void;
}) {
  const locale = useLocale();
  const resolved = resolveScopeHint(hint, companies, current);
  if (!resolved.hinted || resolved.matches) return null;
  return (
    <section className="grid gap-4 text-start">
      <h1 className="text-lg font-semibold">{t(locale, 'customerPackages.title')}</h1>
      <p role="alert">
        {t(locale, resolved.known ? 'customerPackages.scopeRefusal' : 'customerPackages.notAllowed')}
      </p>
      {resolved.choice !== null ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (resolved.choice === null) return;
            onChoose(resolved.choice);
          }}
        >
          {t(locale, 'customerPackages.scopeSwitch')}
        </Button>
      ) : null}
    </section>
  );
}
