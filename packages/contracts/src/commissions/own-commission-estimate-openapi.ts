import { z } from 'zod';

import { ownCommissionEstimate } from './own-commission-estimate.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

/**
 * مسار تقدير عمولتي: الموظفة من الجلسة نفسها، والشهر اختياري، والحالة المخفية بلا أي مبلغ (FR-A02).
 * وعلى جهاز الاستقبال (STAFF_POS) المسار يشترط نافذة عرض خاص حية (FR-A06b).
 */
export const ownCommissionEstimatePaths = {
  '/v1/staff/me/commission-estimate': {
    get: {
      operationId: 'ownCommissionEstimate',
      description:
        'Own commission estimate for one month (FR-A02). The employee comes from the session server-side; any subject key in the query is a 403. Live authority (membership, commissions feature, read:commissions:own) and the month window are checked before the column gate; HIDDEN contains only status and reads no commission row. An approved month answers APPROVED with the approved amount and the corrections as the manager sees them, never the customer (CS-Q30). STAFF_POS requires a live private-view window. Cache-Control: no-store.',
      security: [{ PersonalStaffSession: [] }, { KioskStaffSession: [], DeviceToken: [] }],
      parameters: [
        {
          in: 'query',
          name: 'month',
          required: false,
          schema: { type: 'string', pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' },
        },
        {
          in: 'header',
          name: 'x-private-view-window-id',
          required: false,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'HIDDEN, the live estimate, a pricing failure, or the approved month',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ownCommissionEstimate, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
            },
          },
        },
        '400': { description: 'VALIDATION_FAILED', content: errorContent },
        '401': { description: 'UNAUTHENTICATED', content: errorContent },
        '403': { description: 'FORBIDDEN or PRIVATE_VIEW_EXPIRED', content: errorContent },
        '422': { description: 'MY_PERIOD_OUT_OF_RANGE', content: errorContent },
      },
    },
  },
};
