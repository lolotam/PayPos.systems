// قايمة مستقلة مقصودة: اشتقاقها من سجل السكيما هيخفي نسيان التسجيل بدل ما يكتشفه الاختبار.
import { catalogSchemaNames } from './openapi-schema-names.catalog.js';
import { packageSchemaNames } from './openapi-schema-names.packages.js';
import { sessionSchemaNames } from './openapi-schema-names.sessions.js';
import { discountSchemaNames } from './openapi-schema-names.discounts.js';
import { staffSchemaNames } from './openapi-schema-names.staff.js';
import { identitySchemaNames } from './openapi-schema-names.identity.js';
import { settingsSchemaNames } from './openapi-schema-names.settings.js';
import { commissionSchemaNames } from './openapi-schema-names.commissions.js';
import { tenancySchemaNames } from './openapi-schema-names.tenancy.js';
import { customerSchemaNames } from './openapi-schema-names.customers.js';
import { notificationSchemaNames } from './openapi-schema-names.notifications.js';
import { fileSchemaNames } from './openapi-schema-names.files.js';
import { referenceSchemaNames } from './openapi-schema-names.reference.js';

export const expectedOpenApiSchemaNames = [
  ...catalogSchemaNames,
  ...packageSchemaNames,
  ...sessionSchemaNames,
  ...discountSchemaNames,
  ...staffSchemaNames,
  ...identitySchemaNames,
  ...settingsSchemaNames,
  ...commissionSchemaNames,
  ...tenancySchemaNames,
  ...customerSchemaNames,
  ...notificationSchemaNames,
  ...fileSchemaNames,
  ...referenceSchemaNames,
].sort();
