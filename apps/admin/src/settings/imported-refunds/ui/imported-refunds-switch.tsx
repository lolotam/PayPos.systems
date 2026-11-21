'use client';

import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { importedRefundsFailureMessage } from '../model/imported-refunds-failure';
import { useImportedRefunds } from '../api/use-imported-refunds';
import { useSetImportedRefunds } from '../api/use-set-imported-refunds';

export function ImportedRefundsSwitch({
  companyId,
  userId,
  businessId,
}: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const query = useImportedRefunds(companyId, userId, businessId);
  const mutation = useSetImportedRefunds(companyId, userId, businessId);
  // رفض القراءة (403) بيظهر رسالة من غير مفتاح؛ اللي يوصل الراوت من غير الصلاحية مييشوفش حاجة يلعب فيها.
  if (query.isPending) return null;
  if (query.isError) {
    return <p role="alert">{importedRefundsFailureMessage(query.error, locale)}</p>;
  }
  const enabled = query.data?.imported_refunds_enabled ?? false;
  const writeLanded = mutation.variables !== undefined && enabled === mutation.variables;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        <input
          id="imported-refunds"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={mutation.isPending}
          onChange={(event) => mutation.mutate(event.target.checked)}
        />
        <Label htmlFor="imported-refunds">{t(locale, 'importedRefunds.label')}</Label>
      </div>
      {!enabled ? <p role="status">{t(locale, 'importedRefunds.offNote')}</p> : null}
      {mutation.isError && !writeLanded ? (
        <p role="alert">{importedRefundsFailureMessage(mutation.error, locale)}</p>
      ) : null}
    </div>
  );
}
