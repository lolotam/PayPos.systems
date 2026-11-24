import type { Type } from '@nestjs/common';
import { HealthController } from './shared/health.controller.ts';
import { identityControllers } from './modules/identity/index.ts';
import { tenancyControllers } from './modules/tenancy/index.ts';
import { customersControllers } from './modules/customers/index.ts';
import { catalogControllers } from './modules/catalog/index.ts';
import { ordersControllers } from './modules/orders/index.ts';
import { commissionsControllers } from './modules/commissions/index.ts';
import { settingsControllers } from './modules/settings/index.ts';
import { notificationsControllers } from './modules/notifications/index.ts';
import { staffControllers } from './modules/staff/index.ts';
import { filesControllers } from './modules/files/index.ts';

// The spec reaches the controllers through app.ts, the composition root, so identity code never imports
// other modules.
export const API_CONTROLLERS: readonly Type<unknown>[] = [
  HealthController,
  ...identityControllers,
  ...tenancyControllers,
  ...customersControllers,
  ...catalogControllers,
  ...ordersControllers,
  ...commissionsControllers,
  ...settingsControllers,
  ...notificationsControllers,
  ...staffControllers,
  ...filesControllers,
];
