'use client';

import type { PlanServerAlerts } from '../model/plan-messages';
import { CalcFields } from './calc-fields';
import { PlanSwitchBlock } from './plan-switch-block';
import { TiersBlock } from './tiers-block';

/**
 * بلوكات الخطة التلاتة (الأساسي والشرائح وبيع الباقة) بتنبيهات السيرفر على كل بلوك: الجزء المشترك بين نموذج
 * الخطة العادية ونموذج إصلاح الشهر، فالاتنين بيعرضوا نفس الحقول من غير تكرار.
 *
 * @param props.alerts رفض السيرفر موزّع على البلوكات، أو null
 * @param props.onUserEdit بيتنادى لما المدير يعدّل الشرائح، عشان رسالة السيرفر تختفي
 */
export function PlanBlocks({
  alerts,
  onUserEdit,
}: {
  alerts: PlanServerAlerts | null;
  onUserEdit(): void;
}) {
  return (
    <>
      <PlanSwitchBlock block="base" serverAlert={alerts?.base ?? null}>
        <CalcFields id="base" path="base.calc" />
      </PlanSwitchBlock>
      <TiersBlock serverAlert={alerts?.tiers ?? null} onUserEdit={onUserEdit} />
      <PlanSwitchBlock block="packageSale" serverAlert={alerts?.packageSale ?? null}>
        <CalcFields id="package-sale" path="packageSale.calc" />
      </PlanSwitchBlock>
    </>
  );
}
