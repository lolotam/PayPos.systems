import { commissionOverrideServiceSchemas } from './override-services.js';
import { commissionBlockedCorrectionPaths } from './blocked-corrections-openapi.js';
import { commissionBlockedCorrectionSchemas } from './blocked-corrections.js';
import { commissionPlanEmployeePaths } from './plan-employees-openapi.js';
import { commissionPlanEmployeeSchemas } from './plan-employees.js';
import { commissionPlanVersionPaths } from './plan-versions-openapi.js';
import { commissionPlanVersionSchemas } from './plan-versions.js';
import { commissionServiceOverridePaths } from './service-overrides-openapi.js';
import { commissionServiceOverrideSchemas } from './service-overrides.js';

export const commissionSchemas = [
  ...commissionPlanVersionSchemas,
  ...commissionServiceOverrideSchemas,
  ...commissionOverrideServiceSchemas,
  ...commissionPlanEmployeeSchemas,
  ...commissionBlockedCorrectionSchemas,
];

export const commissionPaths = {
  ...commissionPlanVersionPaths,
  ...commissionServiceOverridePaths,
  ...commissionPlanEmployeePaths,
  ...commissionBlockedCorrectionPaths,
};
