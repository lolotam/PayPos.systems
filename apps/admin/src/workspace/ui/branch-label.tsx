'use client';

import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { displayName } from '../model/display-name';

export function BranchLabel({ branch }: { branch: WorkspaceBranch }) {
  const locale = useLocale();
  return (
    <span className="flex items-center gap-2">
      <span>{displayName(branch, locale)}</span>
      {branch.is_active ? null : <Badge>{t(locale, 'admin.branchInactive')}</Badge>}
    </span>
  );
}
