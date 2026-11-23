import { commissionOverrideServiceSchemas } from './override-services.js';
import { commissionEstimatePaths } from './estimate-openapi.js';
import { commissionEstimateSchemas } from './estimate.js';
import { commissionStatementPaths } from './statement-openapi.js';
import { commissionStatementSchemas } from './statement.js';
import { commissionBlockedCorrectionPaths } from './blocked-corrections-openapi.js';
import { commissionBlockedCorrectionSchemas } from './blocked-corrections.js';
import { commissionPlanEmployeePaths } from './plan-employees-openapi.js';
import { commissionPlanEmployeeSchemas } from './plan-employees.js';
import { commissionPeriodRepairPaths } from './period-repairs-openapi.js';
import { commissionPeriodRepairSchemas } from './period-repairs.js';
import { commissionPlanVersionPaths } from './plan-versions-openapi.js';
import { commissionPlanVersionSchemas } from './plan-versions.js';
import { commissionServiceOverridePaths } from './service-overrides-openapi.js';
import { commissionServiceOverrideSchemas } from './service-overrides.js';

export const commissionSchemas = [
  ...commissionPlanVersionSchemas,
  ...commissionPeriodRepairSchemas,
  ...commissionServiceOverrideSchemas,
  ...commissionOverrideServiceSchemas,
  ...commissionPlanEmployeeSchemas,
  ...commissionBlockedCorrectionSchemas,
  ...commissionEstimateSchemas,
  ...commissionStatementSchemas,
];

export const commissionPaths = {
  ...commissionPlanVersionPaths,
  ...commissionPeriodRepairPaths,
  ...commissionServiceOverridePaths,
  ...commissionPlanEmployeePaths,
  ...commissionBlockedCorrectionPaths,
  ...commissionEstimatePaths,
  ...commissionStatementPaths,
};
