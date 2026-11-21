'use client';

import { useState } from 'react';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { readAccessProof } from '@/shared/api/read-access-proof';
import {
  importedRefundsFailureMessage,
  isImportedRefundsRefusal,
} from '../model/imported-refunds-failure';
import { useImportedRefunds } from '../api/use-imported-refunds';
import { useSetImportedRefunds } from '../api/use-set-imported-refunds';
import { ImportedRefundsControl } from './imported-refunds-control';

type RefundsScope = { companyId: string; userId: string; businessId: string };

export function ImportedRefundsSwitch({ companyId, userId, businessId }: RefundsScope) {
  const locale = useLocale();
  const query = useImportedRefunds(companyId, userId, businessId);
  const mutation = useSetImportedRefunds(companyId, userId, businessId);
  const [confirmed, setConfirmed] = useState<{ key: string; enabled: boolean } | null>(null);
  const key = [companyId, userId, businessId].join(':');
  // كل قيمة معروضة مصدرها قراءة ناجحة في النطاق الحالي، ورفض القراءة يمسح إثباتها.
  const proof = readAccessProof(query);
  const current = proof === 'granted' ? query.data?.imported_refunds_enabled : undefined;
  if (current !== undefined && (confirmed?.key !== key || confirmed.enabled !== current)) {
    setConfirmed({ key, enabled: current });
  } else if (confirmed && (confirmed.key !== key || proof === 'refused')) {
    setConfirmed(null);
  }
  if (proof === 'refused') {
    return <p role="alert">{importedRefundsFailureMessage(query.error, locale)}</p>;
  }
  // أثناء الكتابة وإعادة إثبات القيمة بعدها المفتاح مخفي. رد الكتابة لا يعيد القيمة للعرض.
  if (
    proof === 'pending' ||
    mutation.isPending ||
    ((mutation.isSuccess || mutation.isError) && query.isRefetching)
  )
    return null;
  const lastConfirmed =
    confirmed?.key === key && !isImportedRefundsRefusal(mutation.error)
      ? confirmed.enabled
      : undefined;
  const enabled = current ?? lastConfirmed;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      {enabled !== undefined ? (
        <ImportedRefundsControl
          enabled={enabled}
          disabled={proof !== 'granted'}
          onChange={mutation.mutate}
        />
      ) : null}
      {mutation.isError ? (
        <p role="alert">{importedRefundsFailureMessage(mutation.error, locale)}</p>
      ) : null}
      {proof === 'failed' ? (
        <div role={mutation.isError ? 'status' : 'alert'}>
          {t(locale, 'importedRefunds.loadFailed')}{' '}
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t(locale, 'importedRefunds.retryRead')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
