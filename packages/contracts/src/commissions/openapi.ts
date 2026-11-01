import { commissionPlanVersionPaths } from './plan-versions-openapi.js';
import { commissionPlanVersionSchemas } from './plan-versions.js';
import { commissionServiceOverridePaths } from './service-overrides-openapi.js';
import { commissionServiceOverrideSchemas } from './service-overrides.js';

export const commissionSchemas = [
  ...commissionPlanVersionSchemas,
  ...commissionServiceOverrideSchemas,
];

export const commissionPaths = {
  ...commissionPlanVersionPaths,
  ...commissionServiceOverridePaths,
};
