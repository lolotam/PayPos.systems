import { serviceSessionDaySchemas } from './service-session-day.js';
import { serviceLineEditsSchemas } from './service-session-edits.js';
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
  ...serviceSessionFormSchemas,
  ...serviceSessionRecoverySchemas,
];
