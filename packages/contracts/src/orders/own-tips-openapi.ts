import { z } from 'zod';
import { ownTips } from './own-tips.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
export const ownTipsPaths = {
  '/v1/staff/me/tips': {
    get: {
      operationId: 'ownTips',
      description:
        'Own current-revision tips by method. Live authority and month window are checked before HIDDEN. HIDDEN contains only month/status and issues no tip query. STAFF_POS requires a live private-view window. Cache-Control: no-store.',
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
          description: 'HIDDEN or own CASH/CARD totals as canonical KWD strings',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ownTips, {
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
