import type { Type } from '@nestjs/common';
import { PackageImportPreviewController } from './http/package-import-preview.controller.ts';
import { PackageExtensionController } from './http/package-extension.controller.ts';
import { PackageRefundController } from './http/package-refund.controller.ts';
import { SessionRecoveryController } from './http/session-recovery.controller.ts';
import { ServiceSessionsController } from './http/service-sessions.controller.ts';
import { ServiceSessionFormController } from './http/service-session-form.controller.ts';
import { SessionTipsController } from './http/session-tips.controller.ts';
import { DiscountProposalsController } from './http/discount-proposals.controller.ts';
import { DeviceDiscountProposalsController } from './http/device-discount-proposals.controller.ts';
import { OwnWorkController } from './http/own-work.controller.ts';
import { PackageSalesController } from './http/package-sales.controller.ts';
import { CustomerPackagesController } from './http/customer-packages.controller.ts';

export {
  ordersCapabilitiesQuery,
  ordersDayQuery,
  ordersDeviceProposals,
  ordersDiscountDecisions,
  ordersDiscountRequests,
  ordersLineCancellation,
  ordersLineCancels,
  ordersLineEditHistory,
  ordersLineEdits,
  ordersLinePerformerChangeHistory,
  ordersLinePerformers,
  ordersPendingProposals,
  ordersPerformerOptionsQuery,
  ordersRecordingContextQuery,
  ordersRecoveryConfirm,
  ordersRecoveryQuery,
  ordersRequesterProposals,
  ordersServiceOptionsQuery,
  ordersSessionTips,
  ordersSessionTipsCurrent,
  ordersTransactions,
  ownWorkReads,
} from './orders-query-factories.ts';
export { ordersProviders } from './orders-provider-factories.ts';

export const ordersControllers: Type[] = [
  PackageImportPreviewController,
  PackageExtensionController,
  PackageRefundController,
  SessionRecoveryController,
  ServiceSessionsController,
  ServiceSessionFormController,
  SessionTipsController,
  DiscountProposalsController,
];

ordersControllers.push(DeviceDiscountProposalsController);
ordersControllers.push(OwnWorkController);
ordersControllers.push(PackageSalesController);
ordersControllers.push(CustomerPackagesController);
