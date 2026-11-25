'use client';
import type { CreateServiceInput } from '@pospay/contracts';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

// الحقول القياسية تأخذ 6 أعمدة والقصيرة 4 على شبكة الـ12 عمودًا في نموذج الإضافة فقط.
const GRID_CELL_CLASS = {
  standard: 'col-span-12 flex min-w-0 flex-col gap-3 md:col-span-6',
  short: 'col-span-12 flex min-w-0 flex-col gap-3 md:col-span-4',
} as const;

export function wrapServiceGridCell(
  grid: boolean,
  size: keyof typeof GRID_CELL_CLASS,
  children: ReactNode,
) {
  return grid ? <div className={GRID_CELL_CLASS[size]}>{children}</div> : children;
}

// النص يحفظ دقة الفلس أثناء الإدخال، بما فيها القيم الكبيرة التي لا يمثلها float بدقة.
export function ServiceBasicsFields({ grid = false }: { grid?: boolean }) {
  const locale = useLocale();
  const { register } = useFormContext<CreateServiceInput>();
  return (
    <>
      {wrapServiceGridCell(
        grid,
        'standard',
        <>
          <Label htmlFor="service-name-en">{t(locale, 'catalogServices.nameEn')}</Label>
          <Input id="service-name-en" dir="ltr" {...register('name_en')} />
        </>,
      )}
      {wrapServiceGridCell(
        grid,
        'standard',
        <>
          <Label htmlFor="service-name-ar">{t(locale, 'catalogServices.nameAr')}</Label>
          <Input
            id="service-name-ar"
            dir="rtl"
            {...register('name_ar', {
              setValueAs: (value: unknown) =>
                typeof value === 'string' ? value.trim() || null : null,
            })}
          />
        </>,
      )}
      {wrapServiceGridCell(
        grid,
        'short',
        <>
          <Label htmlFor="service-price">{t(locale, 'catalogServices.price')}</Label>
          <Input
            id="service-price"
            dir="ltr"
            inputMode="decimal"
            {...register('price', { setValueAs: normalizeKwdInput })}
          />
        </>,
      )}
    </>
  );
}
