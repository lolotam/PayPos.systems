'use client';

import type { WorkspaceBusiness, WorkspaceCompany } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';

import type { SelectionChoice } from '@/shared/api/selection-cookie';
import { useLocale } from '@/shared/locale/locale-context';

import { displayName } from '../model/display-name';
import { useWorkspace } from '../model/workspace-provider';
import { BranchLabel } from './branch-label';
import { SelectField } from './select-field';

function namedOptions(
  items: readonly { id: string; name_ar: string | null; name_en: string }[],
  locale: Locale,
) {
  return items.map((item) => ({ value: item.id, label: displayName(item, locale) }));
}

function chooseBusiness(
  company: WorkspaceCompany | undefined,
  businessId: string,
): SelectionChoice {
  return { companyId: company?.id, businessId };
}

function chooseBranch(
  company: WorkspaceCompany | undefined,
  business: WorkspaceBusiness | undefined,
  branchId: string,
): SelectionChoice {
  return { companyId: company?.id, businessId: business?.id, branchId };
}

export function WorkspaceSelector() {
  const locale = useLocale();
  const workspace = useWorkspace();
  if (workspace.status !== 'choose' && workspace.status !== 'ready') return null;
  const company = workspace.status === 'ready' ? workspace.company : undefined;
  const business = workspace.status === 'ready' ? workspace.business : undefined;
  const branch = workspace.status === 'ready' ? workspace.branch : undefined;
  const businesses = company?.businesses ?? [];
  const branches = business?.branches ?? [];
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SelectField
        id="workspace-company"
        label={t(locale, 'admin.companyLabel')}
        placeholder={t(locale, 'admin.chooseCompany')}
        value={company?.id}
        options={namedOptions(workspace.companies, locale)}
        onChange={(companyId) => workspace.choose({ companyId })}
      />
      <SelectField
        id="workspace-business"
        label={t(locale, 'admin.businessLabel')}
        placeholder={t(locale, 'admin.chooseBusiness')}
        value={business?.id}
        options={namedOptions(businesses, locale)}
        disabled={!company}
        onChange={(businessId) => workspace.choose(chooseBusiness(company, businessId))}
      />
      <SelectField
        id="workspace-branch"
        label={t(locale, 'admin.branchLabel')}
        placeholder={t(locale, 'admin.chooseBranch')}
        value={branch?.id}
        options={branches.map((item) => ({ value: item.id, label: <BranchLabel branch={item} /> }))}
        disabled={!business}
        onChange={(branchId) => workspace.choose(chooseBranch(company, business, branchId))}
      />
    </div>
  );
}
