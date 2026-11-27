'use client';

import { useState } from 'react';
import type { OpeningHours } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranch, useSetBranchHours } from '../api/use-branch-hours';
import { branchFailureMessage } from '../model/branch-failure';
import { HoursEditor } from '../ui/hours-editor';

export type BranchesScope = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
};

/** شاشة الفروع: مواعيد عمل الفرع المختار — قراءة الفرع من الخادم وتعديل مواعيده بعد الإنشاء. */
export function BranchesPage({ scope }: { scope: BranchesScope }) {
  const locale = useLocale();
  const branch = useBranch(scope);
  const save = useSetBranchHours(scope);
  const [result, setResult] = useState<'saved' | 'cleared' | null>(null);
  const submit = (hours: OpeningHours | null, onSaved?: () => void) => {
    setResult(null);
    save.mutate(hours, {
      onSuccess: () => {
        onSaved?.();
        setResult(hours === null ? 'cleared' : 'saved');
      },
    });
  };
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'branchHours.title')}
        description={t(locale, 'branchHours.lead')}
      />
      {branch.isError ? (
        <div className="flex flex-col gap-2">
          <p role="alert">
            {t(locale, 'branchHours.loadFailed')} {branchFailureMessage(branch.error, locale)}
          </p>
          <div>
            <Button type="button" variant="outline" onClick={() => void branch.refetch()}>
              {t(locale, 'branchHours.retry')}
            </Button>
          </div>
        </div>
      ) : null}
      {branch.data ? (
        <HoursEditor
          key={branch.data.id}
          branch={branch.data}
          saving={save.isPending}
          failure={save.isError ? branchFailureMessage(save.error, locale) : null}
          result={save.isError ? null : result}
          onSave={submit}
        />
      ) : null}
    </PageShell>
  );
}
