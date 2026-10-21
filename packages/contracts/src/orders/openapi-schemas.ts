import { discountApprovalEventSchemas } from './discount-approval-events.js';
import { discountApprovalSchemas } from './discount-approval.js';
import { serviceSessionDaySchemas } from './service-session-day.js';
import { serviceLineCancellationSchemas } from './service-line-cancellation.js';
import { serviceSessionCapabilitiesSchemas } from './service-session-capabilities.js';
import { serviceLineEditsSchemas } from './service-session-edits.js';
import { serviceLinePerformerChangesSchemas } from './service-session-performer-changes.js';
import { serviceSessionFormSchemas } from './service-session-form-openapi.js';
import { serviceSessionRecoverySchemas } from './service-session-recovery-openapi.js';
import { serviceSessionSchemas } from './service-session.js';
import { sessionTipsSchemas } from './session-tips.js';

/** مخططات orders بالترتيب الذي يسجّله openapi.ts، حتى يبقى الملف تحت حد الأسطر. */
export const orderSchemas = [
  ...serviceSessionSchemas,
  ...sessionTipsSchemas,
  ...serviceSessionDaySchemas,
  ...serviceLineEditsSchemas,
  ...serviceLinePerformerChangesSchemas,
  ...serviceLineCancellationSchemas,
  ...serviceSessionCapabilitiesSchemas,
  ...serviceSessionFormSchemas,
  ...serviceSessionRecoverySchemas,
  ...discountApprovalSchemas,
  ...discountApprovalEventSchemas,
];
