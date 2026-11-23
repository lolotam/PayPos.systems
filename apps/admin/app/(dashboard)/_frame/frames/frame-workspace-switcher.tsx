'use client';

import { t, type Locale } from '@pospay/i18n';
import { WorkspaceSwitcher } from '@pospay/ui';

import type { SelectionChoice } from '@/shared/api/selection-cookie';
import { useLocale } from '@/shared/locale/locale-context';
import { displayName } from '@/workspace/model/display-name';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';

type Named = { id: string; name_ar: string | null; name_en: string };

const optionsOf = (items: readonly Named[], locale: Locale) =>
  items.map((item) => ({ value: item.id, label: displayName(item, locale) }));

const nameOf = (item: Named | undefined, locale: Locale) =>
  item === undefined ? '' : displayName(item, locale);

/**
 * مبدّل الشركة والنشاط والفرع في زر واحد، بنفس اختيارات WorkspaceSelector الحالي وبنفس الكوكي.
 * قبل اختيار النشاط لا اسم تجاري يظهر على الزر، فيحمل نص الدعوة إلى الاختيار ليكون له اسم مرئي وللقارئ الشاشي.
 */
export function FrameWorkspaceSwitcher() {
  const locale = useLocale();
  const labels = useFrameLabels();
  const workspace = useWorkspace();
  const navigationKey = useNavigationKey();
  if (workspace.status !== 'choose' && workspace.status !== 'ready') return null;
  const ready = workspace.status === 'ready' ? workspace : undefined;
  const company = ready?.company;
  const business = ready?.business ?? undefined;
  const branch = ready?.branch;
  const choose = (next: SelectionChoice) => workspace.choose(next);
  return (
    <div className="min-w-0 max-w-56 flex-[1_1_10rem]">
      <WorkspaceSwitcher
        labels={labels.switcher}
        businessName={
          business === undefined
            ? t(locale, company === undefined ? 'admin.chooseCompany' : 'admin.chooseBusiness')
            : nameOf(business, locale)
        }
        branchName={nameOf(branch, locale)}
        companyValue={company?.id ?? ''}
        businessValue={business?.id ?? ''}
        branchValue={branch?.id ?? ''}
        companyOptions={optionsOf(workspace.companies, locale)}
        businessOptions={optionsOf(company?.businesses ?? [], locale)}
        branchOptions={optionsOf(business?.branches ?? [], locale)}
        businessDisabled={company === undefined}
        branchDisabled={business === undefined}
        onCompanyChange={(companyId) => choose({ companyId })}
        onBusinessChange={(businessId) => choose({ companyId: company?.id, businessId })}
        onBranchChange={(branchId) =>
          choose({ companyId: company?.id, businessId: business?.id, branchId })
        }
        resetKey={navigationKey}
      />
    </div>
  );
}
