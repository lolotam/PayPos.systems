import { commissionOverrideServiceSchemas } from './override-services.js';
import { commissionEstimatePaths } from './estimate-openapi.js';
import { commissionEstimateSchemas } from './estimate.js';
import { commissionStatementApprovalPaths } from './statement-approval-openapi.js';
import { commissionStatementApprovalSchemas } from './statement-approval.js';
import { commissionStatementPaths } from './statement-openapi.js';
import { commissionStatementReviewSchemas } from './statement-review.js';
import { commissionStatementSchemas } from './statement.js';
import { commissionBlockedCorrectionPaths } from './blocked-corrections-openapi.js';
import { commissionBlockedCorrectionSchemas } from './blocked-corrections.js';
import { commissionPlanEmployeePaths } from './plan-employees-openapi.js';
import { commissionPlanEmployeeSchemas } from './plan-employees.js';
import { commissionPeriodRepairPaths } from './period-repairs-openapi.js';
import { commissionPeriodRepairSchemas } from './period-repairs.js';
import { commissionPlanVersionPaths } from './plan-versions-openapi.js';
import { commissionPlanVersionSchemas } from './plan-versions.js';
import { commissionStatementPaymentPaths } from './statement-payments-openapi.js';
import { commissionStatementPaymentSchemas } from './statement-payments.js';
import { commissionServiceOverridePaths } from './service-overrides-openapi.js';
import { commissionServiceOverrideSchemas } from './service-overrides.js';
import { commissionStatementExportPaths } from './statement-export-openapi.js';
import { commissionStatementExportSchemas } from './statement-export-requests.js';

export const commissionSchemas = [
  ...commissionPlanVersionSchemas,
  ...commissionStatementPaymentSchemas,
  ...commissionPeriodRepairSchemas,
  ...commissionServiceOverrideSchemas,
  ...commissionOverrideServiceSchemas,
  ...commissionPlanEmployeeSchemas,
  ...commissionBlockedCorrectionSchemas,
  ...commissionEstimateSchemas,
  ...commissionStatementSchemas,
  ...commissionStatementReviewSchemas,
  ...commissionStatementApprovalSchemas,
  ...commissionStatementExportSchemas,
];

export const commissionPaths = {
  ...commissionPlanVersionPaths,
  ...commissionStatementPaymentPaths,
  ...commissionPeriodRepairPaths,
  ...commissionServiceOverridePaths,
  ...commissionPlanEmployeePaths,
  ...commissionBlockedCorrectionPaths,
  ...commissionEstimatePaths,
  ...commissionStatementPaths,
  ...commissionStatementApprovalPaths,
  ...commissionStatementExportPaths,
};
