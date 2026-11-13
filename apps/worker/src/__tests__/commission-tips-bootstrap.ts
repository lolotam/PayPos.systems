import type { TenantWrappers } from '@pospay/db';

import {
  createCommissionTipsBootstrap,
  type CurrentTipSessionsReader,
} from '../modules/commissions/index.ts';
import { readCurrentSessionTips } from '../modules/orders/index.ts';
import { readEmployeeBusiness } from '../modules/staff/index.ts';
import { businessCalendar } from '../modules/tenancy/index.ts';

type BootstrapDependencies = Parameters<typeof createCommissionTipsBootstrap>[0];

/** نطاق التهيئة: شركة واحدة وأنشطة ويوم عمل. */
export type CommissionTipsBootstrapScope = Parameters<
  ReturnType<typeof createCommissionTipsBootstrap>
>[0];

/** مشغّل التهيئة الجاهز: بنطاق واحد يرجع نتيجة التشغيل. */
export type CommissionTipsBootstrapRunner = ReturnType<
  typeof createCommissionTipsBootstrap
>;

export interface CommissionTipsBootstrapTestDependencies
  extends Omit<
    BootstrapDependencies,
    'employeeBusiness' | 'businessCalendar' | 'tipsReader' | 'database'
  > {
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly wrapReader?: (real: CurrentTipSessionsReader) => CurrentTipSessionsReader;
}

// بيربط القرّاء الحقيقيين زي main.ts، لأن spec جوه موديول commissions ممنوع يستورد موديول
// تاني، والاختبارات محتاجة قرّاء staff و tenancy و orders على قاعدة البيانات نفسها.
export function createTestCommissionTipsBootstrap(
  dependencies: CommissionTipsBootstrapTestDependencies,
): CommissionTipsBootstrapRunner {
  const real: CurrentTipSessionsReader = { readPage: readCurrentSessionTips };
  return createCommissionTipsBootstrap({
    ids: dependencies.ids,
    clock: dependencies.clock,
    businessTimeZone: dependencies.businessTimeZone,
    employeeBusiness: readEmployeeBusiness,
    businessCalendar,
    database: dependencies.database,
    tipsReader:
      dependencies.wrapReader === undefined ? real : dependencies.wrapReader(real),
  });
}
