'use client';
import type { CreateBranchServiceCategoryInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

const options = [
  ['BRANCH', 'catalogServiceCategoryBranches.visibilityPrivate'],
  ['BUSINESS', 'catalogServiceCategoryBranches.visibilityShared'],
] as const;

/**
 * اختيار «مين يستخدم التصنيف» في الإنشاء من الفرع، ومن غير اختيار مبدئي: القرار
 * بيرجع للمدير (SI-Q19) والشاشة مش بتختار عنه. الخطأ بيظهر لما يخلّي الاختيار فاضي.
 */
export function ServiceCategoryVisibilityField() {
  const locale = useLocale();
  const { register, formState } = useFormContext<CreateBranchServiceCategoryInput>();
  return (
    <fieldset className="grid gap-2 text-start">
      <legend>{t(locale, 'catalogServiceCategoryBranches.visibilityChoice')}</legend>
      <div
        role="radiogroup"
        aria-label={t(locale, 'catalogServiceCategoryBranches.visibilityChoice')}
        className="grid gap-2"
      >
        {options.map(([value, key]) => (
          <Label key={value} className="flex items-center gap-2">
            <input type="radio" value={value} {...register('visibility')} />
            <span>{t(locale, key)}</span>
          </Label>
        ))}
      </div>
      {formState.errors.visibility ? (
        <p role="alert">{t(locale, 'catalogServiceCategoryBranches.visibilityRequired')}</p>
      ) : null}
    </fieldset>
  );
}
