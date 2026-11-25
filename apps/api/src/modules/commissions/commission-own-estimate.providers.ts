import type { Provider } from '@nestjs/common';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import { ownCommissionPeriodAllowed } from './domain/own-commission-period.ts';
import { OWN_COMMISSION_ESTIMATE_CLOCK } from './http/own-commission-estimate.controller.ts';
import type { CommissionEstimateProviders } from './persistence/commission-estimate-providers.ts';
import { createOwnCommissionEstimateReader } from './persistence/own-commission-estimate.reader.ts';
import { staffColumns } from './persistence/staff-columns.adapter.ts';
import {
  OWN_COMMISSION_ESTIMATE_READS,
  type OwnCommissionEstimateReads,
} from './queries/own-commission-estimate-context.ts';

/** ما بيجي من وحدات تانية ومربوط في الجذر: سياق الموظفة والسلطة، وأسماء الخدمات من الكتالوج. */
export interface OwnCommissionEstimateBindings {
  readonly context: OwnCommissionEstimateReads['context'];
  readonly serviceNames: CommissionEstimateProviders['serviceNames'];
}

/**
 * مزودو تقدير عمولتي (57-3): قراءات المسار وساعته. الوحدة ما بتستوردش identity ولا staff ولا الكتالوج.
 *
 * @param bindings المربوط في الجذر
 * @param clock ساعة الطلب
 * @returns مزودو Nest
 */
export function ownCommissionEstimateProviders(
  bindings: OwnCommissionEstimateBindings,
  clock: Clock = systemClock,
): Provider[] {
  const reads: OwnCommissionEstimateReads = {
    context: bindings.context,
    periodAllowed: ownCommissionPeriodAllowed,
    monthsBack: staffColumns.monthsBack,
    allowed: staffColumns.allowed,
    estimate: createOwnCommissionEstimateReader(bindings.serviceNames),
  };
  return [
    { provide: OWN_COMMISSION_ESTIMATE_READS, useValue: reads },
    { provide: OWN_COMMISSION_ESTIMATE_CLOCK, useValue: clock },
  ];
}
