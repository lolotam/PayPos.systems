'use client';

import type { CommissionPlanEmployeeListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, EmptyState, Label, NativeSelect, UserRound } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** اسم الموظفة بالعربي وقت ما اللغة عربي والاسم موجود، وإلا بالإنجليزي. */
function displayName(item: CommissionPlanEmployeeListItem, locale: Locale): string {
  return locale === 'ar' && item.name_ar !== null ? item.name_ar : item.name_en;
}

/** ملصق الموظفة «الاسم — #الرقم» زي ما بيظهر في الخيار عشان العنوان فوق البلوك يطابقه. */
export function commissionPlanEmployeeLabel(
  item: CommissionPlanEmployeeListItem,
  locale: Locale,
): string {
  return `${displayName(item, locale)} — #${item.employee_number}`;
}

/**
 * لقطة الموظفة: قائمة منسدلة بالاسم والرقم الوظيفي بس، وزرار تحميل لما فيه صفحة تانية،
 * وحالة فاضية لما المفيش موظفين؛ مفيش كتابة حرة ولا UUID.
 */
export function CommissionPlanEmployeePicker({
  items,
  hasNextPage,
  loadingMore,
  onLoadMore,
  value,
  onChange,
}: {
  items: readonly CommissionPlanEmployeeListItem[];
  hasNextPage: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  value: string;
  onChange(employeeId: string): void;
}) {
  const locale = useLocale();
  if (items.length === 0)
    return <EmptyState icon={<UserRound />} title={t(locale, 'commissionPlanBuilder.listEmpty')} />;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="commission-plan-employee">
        {t(locale, 'commissionPlanBuilder.pickerLabel')}
      </Label>
      <NativeSelect
        id="commission-plan-employee"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t(locale, 'commissionPlanBuilder.pickerPlaceholder')}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {commissionPlanEmployeeLabel(item, locale)}
          </option>
        ))}
      </NativeSelect>
      {hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {t(locale, 'commissionPlanBuilder.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
