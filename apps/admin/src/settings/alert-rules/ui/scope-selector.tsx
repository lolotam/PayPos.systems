'use client';

import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function ScopeSelector({
  branches,
  value,
  onChange,
}: {
  branches: readonly WorkspaceBranch[];
  value: string | null;
  onChange: (branchId: string | null) => void;
}) {
  const locale = useLocale();
  if (branches.length === 0) return null;
  return (
    <div className="flex max-w-md flex-col gap-2">
      <Label htmlFor="alert-rules-scope">{t(locale, 'alertRules.scopeLabel')}</Label>
      <NativeSelect
        id="alert-rules-scope"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t(locale, 'alertRules.scopeBusiness')}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {locale === 'ar' && branch.name_ar !== null ? branch.name_ar : branch.name_en}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
