'use client';
import type {
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * زرار الحالة بس: «إخفاء من الفرع» في «مستخدمة» و«تفعيل في الفرع» في «متاحة».
 * الاختيار بيجي من القايمة نفسها، وقرار الإخفاء أو التفعيل بيرجع للقسم عشان السطر
 * العلوي يحتفظ بالنتيجة بعد ما البند ينتقل للتاب التاني.
 */
export function BranchServiceCategoryStateButton({
  view,
  pending,
  onState,
}: {
  view: ServiceCategoryBranchView;
  pending: boolean;
  onState: (state: ServiceCategoryBranchSettingState) => void;
}) {
  const locale = useLocale();
  const hide = view === 'in_use';
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => onState(hide ? 'HIDDEN' : 'ENABLED')}
    >
      {t(
        locale,
        hide ? 'catalogServiceCategoryBranches.hide' : 'catalogServiceCategoryBranches.enable',
      )}
    </Button>
  );
}
