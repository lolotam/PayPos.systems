'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { Card, Label } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { RepairPlanDraft } from '../model/plan-draft';

export type BlockRoot = 'base' | 'tiers' | 'packageSale';

const TITLES: Record<BlockRoot, MessageKey> = {
  base: 'commissionPlanBuilder.blockBase',
  tiers: 'commissionPlanBuilder.blockTiers',
  packageSale: 'commissionPlanBuilder.blockPackageSale',
};

/**
 * بلوك واحد من الخطة: العنوان ومفتاح تشغيل اسمه المتاح ثابت باسم البلوك وتنبيهه؛ الأطفال بيفضلوا
 * ظاهرين ومعطلين لما المفتاح يقفل عشان كتابة المدير تفضل محفوظة، وتنبيه السيرفر بيتقدم على تنبيه الحقل.
 */
export function PlanSwitchBlock({
  block,
  serverAlert,
  children,
}: {
  block: BlockRoot;
  serverAlert?: string | null | undefined;
  children: ReactNode;
}) {
  const locale = useLocale();
  const { formState, register, watch } = useFormContext<RepairPlanDraft>();
  const enabled = watch(`${block}.enabled`);
  const blockError = formState.errors[block]?.message;
  const message = serverAlert ?? (typeof blockError === 'string' ? blockError : null);
  return (
    <Card role="group" aria-label={t(locale, TITLES[block])} className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t(locale, TITLES[block])}</p>
      <div className="flex items-center gap-3">
        <input
          id={`${block}-enabled`}
          type="checkbox"
          role="switch"
          aria-label={t(locale, TITLES[block])}
          {...register(`${block}.enabled`)}
        />
        <Label htmlFor={`${block}-enabled`}>
          {t(locale, enabled ? 'commissionPlanBuilder.blockOn' : 'commissionPlanBuilder.blockOff')}
        </Label>
      </div>
      <fieldset disabled={!enabled} className="flex flex-col gap-3">
        {children}
      </fieldset>
      {message !== null ? <p role="alert">{message}</p> : null}
    </Card>
  );
}
